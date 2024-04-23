/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-plusplus,no-param-reassign */

import crypto from 'crypto';
import { PassThrough, Transform } from 'stream';

import {
  AbortError, context, keepAlive, timeoutSignal,
} from '@adobe/fetch';
import wrapFetch from 'fetch-retry';
import mime from 'mime';
import { CopyObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sizeOf from 'image-size';
import { Upload } from '@aws-sdk/lib-storage';
import { Parser } from './mp4/Parser.js';
import pkgJson from './package.cjs';

sizeOf.disableFS(true);

// cache external urls
const blobCache = {};

// request counter for logging
let requestCounter = 0;

const FETCH_CACHE_SIZE = 10 * 1024 * 1024; // 10mb

/**
 * Number of retries in fetchHeader
 */
const MAX_RETRIES = 3;

const fetchDefaultContext = context({
  maxCacheSize: FETCH_CACHE_SIZE,
});

/**
 * Helper class for uploading images to s3 media bus, based on their content checksum (sha1).
 */
export default class MediaHandler {
  /**
   * Media handler construction.
   * @param {MediaHandlerOptions} opts - options.
   */
  constructor(opts = {}) {
    Object.assign(this, {
      _awsRegion: opts.awsRegion,
      _awsAccessKeyId: opts.awsAccessKeyId,
      _awsSecretAccessKey: opts.awsSecretAccessKey,
      _r2AccountId: opts.r2AccountId,
      _r2AccessKeyId: opts.r2AccessKeyId,
      _r2SecretAccessKey: opts.r2SecretAccessKey,
      _bucketId: opts.bucketId || 'helix-media-bus',
      _contentBusId: opts.contentBusId,
      _owner: opts.owner,
      _repo: opts.repo,
      _ref: opts.ref,

      _log: opts.log || console,
      _noCache: opts.noCache,
      _fetchTimeout: opts.fetchTimeout || 10000,
      _uploadBufferSize: opts.uploadBufferSize || 1024 * 1024 * 5,

      // estimated bandwidth for copying blobs (should be dynamically adapted).
      _bandwidth: 1024 * 1024, // bytes/s

      // start time of the action
      _startTime: Date.now(),

      // maximum time allowed (the default timeout we allow in pipeline is 20s. be conservative)
      _maxTime: opts.maxTime || 10 * 1000,

      // list of uploads (scheduled and completed)
      _uploads: [],

      // blob filter
      _filter: opts.filter || (() => true),

      // authentication header for sources
      _auth: opts.auth || null,

      // resource name prefix
      _namePrefix: opts.namePrefix || '',

      _blobAgent: opts.blobAgent || `mediahandler-${pkgJson.version}`,
    });

    if (!this._owner || !this._repo || !this._ref || !this._contentBusId) {
      throw Error('owner, repo, ref, and contentBusId are mandatory parameters.');
    }

    this._cache = blobCache[this._contentBusId];
    if (!this._cache) {
      blobCache[this._contentBusId] = {};
      this._cache = blobCache[this._contentBusId];
    }

    // adjust _auth to function
    if (typeof this._auth !== 'function') {
      const auth = this._auth;
      this._auth = () => auth;
    }

    const disableR2 = opts.disableR2 || process.env.HELIX_MEDIA_HANDLER_DISABLE_R2;

    if (this._awsRegion && this._awsAccessKeyId && this._awsSecretAccessKey) {
      this._log.info('Creating S3Client with credentials');
      this._s3 = new S3Client({
        region: this._awsRegion,
        credentials: {
          accessKeyId: this._awsAccessKeyId,
          secretAccessKey: this._awsSecretAccessKey,
        },
      });
    } else {
      this._log.info('Creating S3Client without credentials');
      this._s3 = new S3Client();
    }
    if (disableR2) {
      this._log.info('R2 S3Client disabled.');
    } else {
      this._log.info('Creating R2 S3Client');
      this._r2 = new S3Client({
        endpoint: `https://${this._r2AccountId}.r2.cloudflarestorage.com`,
        region: 'us-east-1',
        credentials: {
          accessKeyId: this._r2AccessKeyId,
          secretAccessKey: this._r2SecretAccessKey,
        },
      });
    }

    this.fetchContext = fetchDefaultContext;
    /* c8 ignore next */
    if (opts.forceHttp1 || process.env.HELIX_FETCH_FORCE_HTTP1) {
      this.fetchContext = keepAlive({
        maxCacheSize: FETCH_CACHE_SIZE,
      });
    }
    this.fetch = this.fetchContext.fetch;
    this.fetchRetry = wrapFetch(this.fetch);
  }

  get log() {
    return this._log;
  }

  /**
   * Creates an external resource from the given buffer and properties.
   * @param {Buffer} buffer - buffer with data
   * @param {number} [contentLength] - Size of blob.
   * @param {string} [contentType] - content type
   * @param {string} [sourceUri] - source uri
   * @returns {MediaResource} the external resource object.
   */
  createMediaResource(buffer, contentLength, contentType, sourceUri = '') {
    if (!contentLength) {
      if (!buffer.length) {
        throw Error('createExternalResource() needs contentLength or non-empty buffer');
      }
      // eslint-disable-next-line no-param-reassign
      contentLength = buffer.length;
    }

    // compute hash
    const resource = this._initMediaResource(buffer, contentLength);

    // try to detect dimensions
    const { type, ...dims } = this._getDimensions(buffer, '');

    return MediaHandler.updateBlobURI({
      sourceUri,
      data: buffer.length === contentLength ? buffer : null,
      contentType: MediaHandler.getContentType(type, contentType, sourceUri),
      ...resource,
      meta: {
        alg: '8k',
        agent: this._blobAgent,
        src: sourceUri,
        ...dims,
      },
    });
  }

  /**
   * Creates an external resource from the given stream and properties.
   * @param {Readable} stream - readable stream
   * @param {number} [contentLength] - Size of blob.
   * @param {string} [contentType] - content type
   * @param {string} [sourceUri] - source uri
   * @returns {MediaResource} the external resource object.
   */
  async createMediaResourceFromStream(stream, contentLength, contentType, sourceUri = '') {
    if (!contentLength) {
      throw Error('createExternalResourceFromStream() needs contentLength');
    }
    // in order to compute hash, we need to read at least 8192 bytes
    const partialBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      let read = 0;
      const readMax = Math.min(contentLength, 8192);

      const done = () => {
        // eslint-disable-next-line no-use-before-define
        stream.removeListener('readable', onReadable);
        // eslint-disable-next-line no-use-before-define
        stream.removeListener('end', onEnd);
        const buf = Buffer.concat(chunks);
        stream.unshift(buf);
        resolve(buf);
      };
      /* c8 ignore next 3 */
      const onEnd = () => {
        done();
      };
      const onReadable = () => {
        let chunk;
        // eslint-disable-next-line yoda, no-cond-assign
        while (null !== (chunk = stream.read())) {
          chunks.push(chunk);
          read += chunk.length;
          if (read >= readMax) {
            done();
            break;
          }
        }
      };

      stream.on('readable', onReadable);
      stream.on('end', onEnd);
      stream.on('error', (e) => {
        reject(Error(`Error reading stream: ${e.code}`));
      });
    });

    // compute hash
    const resource = this._initMediaResource(partialBuffer, contentLength);

    // try to detect dimensions
    const { type, ...dims } = this._getDimensions(partialBuffer, '');

    return MediaHandler.updateBlobURI({
      sourceUri,
      stream,
      contentType: MediaHandler.getContentType(type, contentType, sourceUri),
      ...resource,
      meta: {
        alg: '8k',
        agent: this._blobAgent,
        src: sourceUri,
        ...dims,
      },
    });
  }

  /**
   * Fetches the metadata from the media bus for the given resource
   *
   * @param {MediaResource} blob - the resource object.
   * @returns {BlobMeta} the blob metadata
   */
  async fetchMetadata(blob) {
    const { log } = this;
    const c = requestCounter++;
    try {
      log.debug(`[${c}] HEAD ${blob.storageUri}`);
      const result = await this._s3.send(new HeadObjectCommand({
        Bucket: this._bucketId,
        Key: blob.storageKey,
      }));
      log.info(`[${c}] Metadata loaded for: ${blob.storageUri}`);
      return result.Metadata;
    } catch (e) {
      /* c8 ignore next */
      log.info(`[${c}] Blob ${blob.storageUri} does not exist: ${e.$metadata.httpStatusCode || e.message}`);
      return null;
    }
  }

  /**
   * Checks if the blob already exists using a HEAD request to the blob's metadata.
   * On success, it also updates the metadata of the external resource.
   *
   * @param {MediaResource} blob - the resource object.
   * @returns {boolean} `true` if the resource exists.
   */
  async checkBlobExists(blob) {
    const meta = await this.fetchMetadata(blob);
    if (!meta) {
      return false;
    }
    // eslint-disable-next-line no-param-reassign
    blob.meta = meta;
    MediaHandler.updateBlobURI(blob);
    return true;
  }

  /**
   * Returns the dimensions object for the given data.
   * @param {Buffer} data
   * @param {number} c request counter for logging
   * @returns {{}|{width: string, height: string}}
   * @private
   */
  _getDimensions(data, c) {
    if (!data) {
      return {};
    }
    const info = new Parser(data, this._log).parse();
    if (info) {
      return {
        width: String(info.width),
        height: String(info.height),
        duration: String(info.duration),
        type: info.mimeType,
      };
    }

    try {
      const dimensions = sizeOf(data);
      this._log.info(`[${c}] detected dimensions: ${dimensions.type} ${dimensions.width} x ${dimensions.height}`);
      return {
        width: String(dimensions.width),
        height: String(dimensions.height),
        type: mime.getType(dimensions.type),
      };
    } catch (e) {
      this._log.warn(`[${c}] error detecting dimensions: ${e}`);
      return {};
    }
  }

  /**
   * Fetches the header (8192 bytes) of the resource assuming the server supports range requests.
   *
   * @param {string} uri Resource URI
   * @returns {MediaResource} resource information
   */
  async fetchHeader(uri) {
    const { log } = this;
    const c = requestCounter++;
    log.debug(`[${c}] GET ${uri}`);
    let res;

    const opts = {
      method: 'GET',
      headers: {
        range: 'bytes=0-8192',
        'accept-encoding': 'identity',
      },
      cache: 'no-store',
      signal: timeoutSignal(this._fetchTimeout),
      retryOn: (attempt, error, response) => {
        // if the fetch timeout exceeded, stop now
        if (error instanceof AbortError) {
          return false;
        }
        // retry on any network error or 5xx status codes
        if (attempt < MAX_RETRIES && (error !== null || response.status >= 500)) {
          log.debug(`failed with ${error || response.status}: retrying (attempt# ${attempt + 1}/${MAX_RETRIES})`);
          return true;
        }
        return false;
      },
    };
    try {
      const auth = this._auth(new URL(uri));
      if (auth) {
        opts.headers.authorization = auth;
      }
      res = await this.fetchRetry(uri, opts);
    } catch (e) {
      log.info(`[${c}] Failed to fetch header of ${uri}: ${e.message}`);
      return null;
    } finally {
      opts.signal.clear();
    }

    if (res.redirected) {
      log.debug(`[${c}] redirected ${uri} -> ${res.url}`);
    }
    const body = await res.buffer();
    log.debug(`[${c}]`, {
      statusCode: res.status,
      headers: res.headers.plain(),
    });
    if (!res.ok) {
      log.info(`[${c}] Failed to fetch header of ${uri}: ${res.status}`);
      return null;
    }

    // decode range header. since we only get the first 8192 bytes, the `content-range` header
    // will contain the information about the true content-length of the resource. eg:
    //
    // Content-Range: bytes 0-8192/183388
    let contentLength = 0;
    let data;
    const cr = (res.headers.get('content-range') || '').split('/')[1];
    if (cr) {
      contentLength = Number.parseInt(cr, 10);
      if (Number.isNaN(contentLength)) {
        contentLength = 0;
      }
    } else {
      // no content range header...assuming server doesn't support range requests.
      log.warn(`[${c}] no content-range header for ${uri}. using entire body`);
      contentLength = body.length;
      data = body;
    }
    if (!contentLength) {
      if (body.length) {
        log.warn(`[${c}] inconsistent lengths while fetching header of ${uri}.`);
        contentLength = body.length;
      }
    }

    // try to detect dimensions
    const { type, ...dims } = this._getDimensions(data, c);

    // compute the content type
    let contentType = res.headers.get('content-type');
    if (!contentType) {
      contentType = MediaHandler.getContentType(type, undefined, uri);
    }

    // compute hashes
    const hashInfo = this._initMediaResource(body, contentLength);
    return MediaHandler.updateBlobURI({
      originalUri: res.url,
      data,
      contentType,
      lastModified: res.headers.get('last-modified'),
      meta: {
        alg: '8k',
        agent: this._blobAgent,
        src: uri,
        ...dims,
      },
      ...hashInfo,
    });
  }

  /**
   * Computes the content hash of the given buffer and returns the media resource
   * @param {Buffer} buffer
   * @param {number} contentLength
   * @returns {MediaResource} media resource
   * @private
   */
  _initMediaResource(buffer, contentLength) {
    // compute hashes
    let hashBuffer = buffer;
    if (hashBuffer.length > 8192) {
      hashBuffer = hashBuffer.slice(0, 8192);
    }
    const contentHash = crypto.createHash('sha1')
      .update(String(contentLength))
      .update(hashBuffer)
      .digest('hex');
    const hash = `1${contentHash}`;
    const storageKey = `${this._contentBusId}/${this._namePrefix}${hash}`;

    return MediaHandler.updateBlobURI({
      storageUri: `s3://${this._bucketId}/${storageKey}`,
      storageKey,
      owner: this._owner,
      repo: this._repo,
      ref: this._ref,
      contentBusId: this._contentBusId,
      contentLength,
      hash,
    });
  }

  /**
   * Stores the metadata of the blob in the media bus.
   * @param {MediaResource} blob
   */
  async putMetaData(blob) {
    const { log } = this;
    const c = requestCounter++;

    const input = {
      Bucket: this._bucketId,
      Key: blob.storageKey,
      CopySource: `${this._bucketId}/${blob.storageKey}`,
      Metadata: blob.meta,
      MetadataDirective: 'REPLACE',
    };
    log.debug(`[${c}] COPY ${blob.storageUri}`);
    // send cmd to s3 and r2 (mirror) in parallel
    const result = await Promise.allSettled([
      this._s3.send(new CopyObjectCommand(input)),
      this._r2
        ? this._r2.send(new CopyObjectCommand(input))
        : Promise.resolve(),
    ]);
    const rejected = result.filter(({ status }) => status === 'rejected');
    if (!rejected.length) {
      log.info(`[${c}] Metadata updated for: ${blob.storageUri}`);
      MediaHandler.updateBlobURI(blob);
    } else {
      // at least 1 cmd failed
      const type = result[0].status === 'rejected' ? 'S3' : 'R2';
      const e = rejected[0].reason;
      log.info(`[${c}] [${type}] Failed to update metadata for ${blob.storageUri}: ${e.$metadata.httpStatusCode || e.message}`);
    }
  }

  /**
   * Gets the blob information for the external resource addressed by uri. It also ensured that the
   * addressed blob is uploaded to the blob store.
   *
   * @param {string} sourceUri - URI of the external resource.
   * @param {string} [src] - source document (meta.src). defaults to `uri`.
   * @returns {MediaResource} the external resource object or null if not exists.
   */
  async getBlob(sourceUri, src) {
    if (!this._noCache && sourceUri in this._cache) {
      return this._cache[sourceUri];
    }
    const blob = await this.transfer(sourceUri, src);
    if (!blob) {
      return null;
    }

    // don't cache the data
    delete blob.data;

    if (!this._noCache) {
      this._cache[sourceUri] = blob;
    }
    return blob;
  }

  /**
   * Transfers the blob with the given URI to the media storage.
   *
   * @param {string} sourceUri source uri
   * @param {string} [src] - source document (meta.src). defaults to `uri`.
   * @returns {MediaResource} the external resource object or {@code null} if the source
   *          does not exist.
   */
  async transfer(sourceUri, src) {
    const blob = await this.fetchHeader(sourceUri);
    if (!blob) {
      return null;
    }
    if (src) {
      blob.meta.src = src;
    }
    if (!this._filter(blob)) {
      this._log.info(`filter rejected blob ${blob.uri}.`);
      return null;
    }

    // check if already exists
    const exist = await this.checkBlobExists(blob);
    if (!exist) {
      await this.upload(blob);
    }
    return blob;
  }

  /**
   * Transfers the blob to the media storage. If the blob does not have data, it is downloaded from
   * the source uri. otherwise the blob is uploaded directly.
   *
   * @param {MediaResource} blob The resource to transfer.
   * @returns {boolean} {@code true} if successful.
   */
  async upload(blob) {
    if (blob.stream || (blob.data && blob.data.length === blob.contentLength)) {
      return this.put(blob);
    }
    return this.spool(blob);
  }

  /**
   * Puts the blob to the blob store.
   * @param {MediaResource} blob - the resource object.
   * @returns {Promise<boolean>} `true` if the upload succeeded.
   */
  async put(blob) {
    const { log } = this;
    const c = requestCounter++;

    if (blob.originalUri) {
      log.info(`[${c}] Upload ${blob.originalUri} -> ${blob.uri}`);
    } else {
      log.info(`[${c}] Upload to ${blob.storageUri}`);
    }

    // check for dimensions
    let bufferSize = 0;
    const buffers = [];
    if (!blob.meta.width) {
      if (blob.data) {
        const { width, height, duration } = this._getDimensions(blob.data, c);
        if (width) {
          blob.meta.width = width;
          blob.meta.height = height;
        }
        if (duration) {
          blob.meta.duration = duration;
        }
      } else {
        // create transform stream and store the first mb
        const capture = new Transform({
          transform(chunk, encoding, callback) {
            /* istanbul ignore next */
            if (bufferSize < 1024 * 1024) {
              // log.debug(`[${c}] cache buffer ${chunk.length}.`);
              buffers.push(chunk);
              bufferSize += chunk.length;
            }
            callback(null, chunk);
          },
        });
        blob.stream = blob.stream.pipe(capture);
      }
    }

    const params = {
      Bucket: this._bucketId,
      Key: blob.storageKey,
      Body: blob.data || blob.stream,
      ContentType: blob.contentType,
      Metadata: blob.meta,
    };

    let s3Body;
    let r2Body;
    if (!Buffer.isBuffer(params.Body)) {
      // Body is a stream:
      const stream = params.Body;
      // need to create separate readable streams for s3 and r2
      s3Body = new PassThrough();
      stream.pipe(s3Body);
      if (this._r2) {
        r2Body = new PassThrough();
        stream.pipe(r2Body);
      }
    } else {
      // Body is a buffer
      s3Body = params.Body;
      r2Body = params.Body;
    }
    const s3Upload = new Upload({
      client: this._s3,
      params: { ...params, Body: s3Body },
    });
    const r2Upload = this._r2
      ? new Upload({
        client: this._r2,
        params: { ...params, Body: r2Body },
      })
      : null;

    // upload to s3 and r2 (mirror) in parallel
    const result = await Promise.allSettled([
      s3Upload.done(),
      r2Upload ? r2Upload.done() : Promise.resolve(),
    ]);
    const rejected = result.filter(({ status }) => status === 'rejected');
    // discard data
    delete blob.stream;
    delete blob.data;
    if (!rejected.length) {
      log.info(`[${c}] Upload done ${blob.storageKey}: ${result[0].value.Location}`);
    } else {
      // at least 1 cmd failed
      const type = result[0].status === 'rejected' ? 'S3' : 'R2';
      const e = rejected[0].reason;
      log.error(`[${c}] [${type}]: Failed to upload blob ${blob.storageKey}: ${e.status || e.message}`);
      return false;
    }

    // check if we need to update the metadata with the dimensions
    if (buffers.length) {
      const { width, height } = this._getDimensions(Buffer.concat(buffers), c);
      if (width) {
        blob.meta.width = width;
        blob.meta.height = height;
        await this.putMetaData(blob);
      }
    }
    MediaHandler.updateBlobURI(blob);
    return true;
  }

  /**
   * Transfers the blob from the source to the media storage.
   *
   * @param {MediaResource} blob The resource to transfer.
   * @returns {boolean} {@code true} if successful.
   */
  async spool(blob) {
    const { log } = this;
    const c = requestCounter++;
    log.info(`[${c}] Download ${blob.originalUri} -> ${blob.storageUri}`);

    // fetch the source blob
    const opts = {
      cache: 'no-store',
      headers: {
        // azure does not support transfer encoding:
        // HTTP Error 501. The request transfer encoding type is not supported.
        'accept-encoding': 'identity',
      },
    };
    const auth = this._auth(new URL(blob.originalUri));
    if (auth) {
      opts.headers.authorization = auth;
    }
    const source = await this.fetch(blob.originalUri, opts);
    if (!source.ok) {
      log.info(`[${c}] Download failed: ${source.status}`);
      return false;
    }
    log.info(`[${c}] Download success: ${source.status}`);
    blob.lastModified = source.headers.get('last-modified');
    blob.contentType = MediaHandler.sanitizeContentType(source.headers.get('content-type'));
    blob.contentLength = Number.parseInt(source.headers.get('content-length'), 10);

    // the s3 multipart uploader has a default min size of 5mb, so download smaller images when
    // dimensions are missing
    if (!blob.meta.width && blob.contentLength < this._uploadBufferSize) {
      blob.data = await source.buffer();
    } else {
      blob.stream = source.body;
    }

    // get metadata
    let metaData = {};
    try {
      metaData = JSON.parse(source.headers.get('x-ms-meta-name') || '{}');
    } catch (e) {
      // ignore
    }
    if (blob.lastModified) {
      metaData['source-last-modified'] = blob.lastModified;
    }
    blob.meta = {
      ...blob.meta,
      ...metaData,
    };
    return this.put(blob);
  }

  /**
   * Regenerates the `uri` property of the given resource including the proper extension and
   * dimensions if available.
   * @param {MediaResource} blob The resource to update.
   * @return {MediaResource} the resource.
   */
  static updateBlobURI(blob) {
    const {
      owner,
      repo,
      ref,
      hash,
    } = blob;
    const ext = mime.getExtension(blob.contentType) || 'bin';
    let fragment = '';
    if (blob.meta && blob.meta.width && blob.meta.height && !blob.contentType?.match(/^video\/[^/]+$/)) {
      fragment = `#width=${blob.meta.width}&height=${blob.meta.height}`;
    }
    blob.uri = `https://${ref}--${repo}--${owner}.hlx.page/media_${hash}.${ext}${fragment}`;
    return blob;
  }

  static sanitizeContentType(type) {
    if (!type) {
      return type;
    }
    const segs = type.toLowerCase()
      .split(';')
      .map((s) => s.trim())
      .filter((s) => !!s);
    if (segs[0] === 'image/jpg') {
      segs[0] = 'image/jpeg';
    }
    if (segs[1] && segs[1].startsWith('charset')) {
      // eslint-disable-next-line default-case
      switch (segs[0]) {
        case 'image/jpeg':
        case 'image/png':
        case 'image/gif':
        case 'application/octet-stream':
          segs.pop();
      }
    }
    return segs.join(';');
  }

  /**
   * Returns the best content type. Prioritizes the detected content type over the hinted one over
   * the one derived from the uri. By also favoring non application/octet-stream ones.
   */
  static getContentType(detectedType, hintedType, uri) {
    const uriType = mime.getType(uri);
    // get first non octet stream type
    for (const type of [detectedType, hintedType, uriType]) {
      if (type && type !== 'application/octet-stream') {
        return type;
      }
    }
    return 'application/octet-stream';
  }
}
