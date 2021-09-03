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

const crypto = require('crypto');
const { Transform } = require('stream');
const fetchAPI = require('@adobe/helix-fetch');
const mime = require('mime');
const {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const sizeOf = require('image-size');
const { version } = require('../package.json');

sizeOf.disableFS(true);

// cache external urls
const blobCache = {};

// request counter for logging
let requestCounter = 0;

const FETCH_CACHE_SIZE = 10 * 1024 * 1024; // 10mb

const fetchDefaultContext = fetchAPI.context({
  maxCacheSize: FETCH_CACHE_SIZE,
});

/**
 * Helper class for uploading images to s3 media bus, based on their content checksum (sha1).
 */
class MediaHandler {
  /**
   * Media handler construction.
   * @param {MediaHandlerOptions} opts - options.
   */
  constructor(opts = {}) {
    Object.assign(this, {
      _awsRegion: opts.awsRegion || process.env.AWS_S3_REGION,
      _awsAccessKeyId: opts.awsAccessKeyId || process.env.AWS_S3_ACCESS_KEY_ID,
      _awsSecretAccessKey: opts.awsSecretAccessKey || process.env.AWS_S3_SECRET_ACCESS_KEY,
      _bucketId: opts.bucketId || 'helix-media-bus',
      _contentBusId: opts.contentBusId,
      _owner: opts.owner,
      _repo: opts.repo,
      _ref: opts.ref,

      _log: opts.log || console,
      _cache: blobCache,
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

      _blobAgent: opts.blobAgent || `blobhandler-${version}`,
    });

    if (!this._owner || !this._repo || !this._ref || !this._contentBusId) {
      throw Error('owner, repo, ref, and contentBusId are mandatory parameters.');
    }

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

    this.fetchContext = fetchDefaultContext;
    // eslint-disable-next-line no-constant-condition
    if (opts.forceHttp1 || process.env.HELIX_FETCH_FORCE_HTTP1) {
      this.fetchContext = fetchAPI.context({
        alpnProtocols: [fetchAPI.ALPN_HTTP1_1],
        maxCacheSize: FETCH_CACHE_SIZE,
      });
    }
    this.fetch = this.fetchContext.fetch;
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
      contentType: contentType || type || mime.getType(sourceUri) || 'application/octet-stream',
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
   * Creates an external resource from the given buffer and properties.
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
    // ensure readable
    await new Promise((resolve) => {
      stream.once('readable', resolve);
    });

    // in order to compute hash, we need to read at least 8192 bytes
    const partialBuffer = stream.read(Math.min(contentLength, 8192));
    stream.unshift(partialBuffer);

    // compute hash
    const resource = this._initMediaResource(partialBuffer, contentLength);

    // try to detect dimensions
    const { type, ...dims } = this._getDimensions(partialBuffer, '');

    return MediaHandler.updateBlobURI({
      sourceUri,
      stream,
      contentType: contentType || type || mime.getType(sourceUri) || 'application/octet-stream',
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
    const c = requestCounter++;
    this._log.debug(`[${c}] GET ${uri}`);
    let res;
    const opts = {
      method: 'GET',
      headers: {
        range: 'bytes=0-8192',
        'accept-encoding': 'identity',
      },
      cache: 'no-store',
      signal: this.fetchContext.timeoutSignal(this._fetchTimeout),
    };
    if (this._auth) {
      opts.headers.authorization = this._auth;
    }
    try {
      res = await this.fetch(uri, opts);
    } catch (e) {
      this._log.info(`[${c}] Failed to fetch header of ${uri}: ${e.message}`);
      return null;
    } finally {
      opts.signal.clear();
    }

    if (res.redirected) {
      this._log.debug(`[${c}] redirected ${uri} -> ${res.url}`);
    }
    const body = await res.buffer();
    this._log.debug(`[${c}]`, {
      statusCode: res.status,
      headers: res.headers.plain(),
    });
    if (!res.ok) {
      this._log.info(`[${c}] Failed to fetch header of ${uri}: ${res.status}`);
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
      this._log.warn(`[${c}] no content-range header for ${uri}. using entire body`);
      contentLength = body.length;
      data = body;
    }
    if (!contentLength) {
      if (body.length) {
        this._log.warn(`[${c}] inconsistent lengths while fetching header of ${uri}.`);
        contentLength = body.length;
      }
    }

    // try to detect dimensions
    const { type, ...dims } = this._getDimensions(data, c);

    // compute the content type
    let contentType = res.headers.get('content-type');
    if (!contentType) {
      contentType = type || mime.getType(uri) || 'application/octet-stream';
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
    try {
      log.debug(`[${c}] COPY ${blob.storageUri}`);
      await this._s3.send(new CopyObjectCommand({
        Bucket: this._bucketId,
        Key: blob.storageKey,
        CopySource: `${this._bucketId}/${blob.storageKey}`,
        Metadata: blob.meta,
        MetadataDirective: 'REPLACE',
      }));
      log.info(`[${c}] Metadata updated for: ${blob.storageUri}`);
      MediaHandler.updateBlobURI(blob);
    } catch (e) {
      log.info(`[${c}] Failed to update metadata for ${blob.storageUri}: ${e.$metadata.httpStatusCode || e.message}`);
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
   * @returns {boolean} `true` if the upload succeeded.
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
        const { width, height } = this._getDimensions(blob.data, c);
        if (width) {
          blob.meta.width = width;
          blob.meta.height = height;
        }
      } else {
        // create transfer stream and store the first mb
        const capture = new Transform({
          transform(chunk, encoding, callback) {
            /* istanbul ignore next */
            if (bufferSize < 1024 * 1024) {
              log.debug(`[${c}] cache buffer ${chunk.length}.`);
              buffers.push(chunk);
              bufferSize += chunk.length;
            }
            callback(null, chunk);
          },
        });
        blob.stream = blob.stream.pipe(capture);
      }
    }

    const upload = new Upload({
      client: this._s3,
      params: {
        Bucket: this._bucketId,
        Key: blob.storageKey,
        Body: blob.data || blob.stream,
        ContentType: blob.contentType,
        Metadata: blob.meta,
      },
    });

    try {
      const result = await upload.done();
      log.info(`[${c}] Upload done ${blob.storageKey}: ${result.Location}`);
    } catch (e) {
      log.error(`[${c}] Failed to upload blob ${blob.storageKey}: ${e.status || e.message}`);
      return false;
    } finally {
      // discard data
      delete blob.stream;
      delete blob.data;
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
    if (this._auth) {
      opts.headers.authorization = this._auth;
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
    if (blob.meta && blob.meta.width && blob.meta.height) {
      fragment = `#width=${blob.meta.width}&width=${blob.meta.height}`;
    }
    blob.uri = `https://${ref}--${repo}--${owner}.hlx3.page/media_${hash}.${ext}${fragment}`;
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
}

module.exports = MediaHandler;
