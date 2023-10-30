/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import * as stream from "stream";

/**
 * Default Resource Meta
 */
export declare interface MediaMeta {
  /**
   * Agent used to upload the blob
   */
  agent: string,

  /**
   * hash algorithm used
   */
  alg: string,

  /**
   * source uri
   */
  src?: string,

  /**
   * image width
   */
  width?: string,

  /**
   * image height
   */
  height?: string,
}

/**
 * Media resource
 */
export declare interface MediaResource {

  /**
   * URI of the media resource in the format `https://{ref}--{repo}--{owner}.hlx.page/media_{sha}`
   * @example "https://ref--repo--owner.hlx.page/media_xxxxyyyyzzzz.png#width=477&width=268"
   */
  uri: string,

  /**
   * Storage URI of the media resource `s3://helix-media-bus/{contentBusId}/{sha}`
   * @example "s3://helix-media-bus/44556677/xxxxyyyyzzzz"
   */
  storageUri: string,

  /**
   * Storage Key of the media resource `{contentBusId}/{sha}`
   * @example "44556677/xxxxyyyyzzzz"
   */
  storageKey: string,

  /**
   * Media owner
   */
  owner: string,

  /**
   * Media owner repo
   */
  repo: string,

  /**
   * Media owner ref
   */
  ref: string,

  /**
   * ContentBus ID of the media resource
   * @example "44556677"
   */
  contentBusId: string,

  /**
   * URI of the original resource
   */
  originalUri: string,

  /**
   * Content hash.
   * sha1('size' + 8192bytes)
   */
  hash: string,

  /**
   * last modified
   */
  lastModified: string,

  /**
   * Content type.
   */
  contentType: string,

  /**
   * Content length.
   */
  contentLength: number,

  /**
   * Data of the blob while processing.
   */
  data?: Buffer,

  /**
   * Data of the blob while processing.
   */
  stream?: stream.Readable,

  /**
   * Metadata read via the `x-ms-meta-name` header.
   */
  meta?: MediaMeta,
}

/**
 * Filter function for blobs.
 */
declare type MediaFilter = (blob: MediaResource) => boolean;

/**
 * Provide the auth header for the given url
 */
declare type AuthHeaderProvider = (url: URL) => string;

export declare interface MediaHandlerOptions {
  /**
   * AWS region
   */
  awsRegion?: string,

  /**
   * AWS access key ID
   */
  awsAccessKeyId?: string,

  /**
   * AWS secret access key
   */
  awsSecretAccessKey?: string,

  /**
   * Cloudflare account ID
   */
  r2AccountId?: string,

  /**
   * Cloudflare access key ID
   */
  r2AccessKeyId?: string,

  /**
   * Cloudflare secret access key
   */
  r2SecretAccessKey?: string,

  /**
   * Media owner
   */
  owner: string,

  /**
   * Media owner repo
   */
  repo: string,

  /**
   * Media owner ref
   */
  ref: string,

  /**
   * ContentBus ID of the media resources
   * @example "44556677"
   */
  contentBusId: string,

  /**
   * media bus bucket id
   * @default `'helix-media-bus'`
   */
  bucketId?: string,

  /**
   * logger
   * @default `console`
   */
  log?: any,

  /**
   * Force http1.0
   * @default false
   */
  forceHttp1?: boolean,

  /**
   * Disables the caching in `getBlob()`
   * @default false
   */
  noCache?: boolean,

  /**
   * Specifies the maximum time that should be used for uploading
   * @default 10000
   */
  maxTime?: number,

  /**
   * Filter function to accept/reject blobs based on their HEAD request.
   */
  filter?: MediaFilter,

  /**
   * Time in milliseconds that requesting a blob header is allowed to take.
   * @default 10000
   */
  fetchTimeout?: number,

  /**
   * Prefix prepended to the computed resource name (mainly used for testing)
   */
  namePrefix?: string,

  /**
   * Agent that uses the blob handler (eg word2md, importer, etc)
   */
  blobAgent?: string,

  /**
   * Authentication header for fetching sources.
   */
  auth?: string|AuthHeaderProvider,

  /**
   * Size of the upload buffer to calculate image size if missing.
   * @default 5mb
   */
  uploadBufferSize?: number,

  /**
   * if set, content will never be written to R2
   * @default `process.env.HELIX_MEDIA_HANDLER_DISABLE_R2`
   */
  disableR2?: boolean,
}

/**
 * Media handler to upload media to the bus. One media handler instance is bound to a project,
 * i.e. owner, repo, ref, contentBusId are the same for all uploads.
 */
export declare class MediaHandler {
  /**
   * Creates a new media handler
   * @param options
   * @throws Error If the options are invalid.
   */
  constructor(options: MediaHandlerOptions);

  /**
   * Creates a media resource from the given buffer and properties.
   * @param {Buffer} buffer - buffer with data
   * @param {number} contentLength - Size of blob.
   * @param {string} [contentType] - content type
   * @param {string} [sourceUri] - source uri
   * @returns {MediaResource} the external resource object.
   */
  createMediaResource(buffer: Buffer, contentLength: number, contentType?: string, sourceUri?: string): MediaResource;

  /**
   * Creates an media resource from the given stream and properties.
   * @param {stream.Readable} stream - readable stream
   * @param {number} [contentLength] - Size of blob.
   * @param {string} [contentType] - content type
   * @param {string} [sourceUri] - source uri
   * @returns {Promise<MediaResource>} the external resource object.
   */
  createMediaResourceFromStream(stream: stream.Readable, contentLength: number, contentType?:string, sourceUri?: string): Promise<MediaResource>;

    /**
   * Checks if the blob already exists using a GET request to the blob's metadata.
   * On success, it also updates the metadata of the external resource.
   *
   * @param {MediaResource} blob - the resource object.
   * @returns {Promise<boolean>} `true` if the resource exists.
   */
  checkBlobExists(blob: MediaResource): Promise<boolean>;

  /**
   * Fetches the header (1024 bytes) of the resource assuming the server supports range requests.
   *
   * @param {string} uri Resource URI
   * @returns {Promise<MediaResource>} resource information
   */
  fetchHeader(uri: string): Promise<MediaResource>;

  /**
   * Stores the metadata of the blob in the media bus.
   * @param {ExternalResource} blob
   * @return {Promise<void>}
   */
  putMetaData(blob: MediaResource): Promise<void>;

  /**
   * Gets the blob information for the external resource addressed by uri. It also ensured that the
   * addressed blob is uploaded to the blob store.
   *
   * @param {string} uri - URI of the external resource.
   * @param {string} [src] - source document (meta.src). defaults to `uri`.
   * @returns {Promise<MediaResource>} the external resource object or null if not exists.
   */
  getBlob(uri: string, src?: string): Promise<MediaResource>;

  /**
   * Uploads the blob to the blob store. If the blob has not data, it is _spooled_ from the
   * source uri.
   * @param {MediaResource} blob - the resource object.
   * @returns {Promise<boolean>} `true` if the upload succeeded.
   */
  upload(blob: MediaResource): Promise<boolean>;

  /**
   * Puts the blob to the blob store.
   *
   * @param {MediaResource} blob - the resource object.
   * @returns {Promise<boolean>} `true` if the upload succeeded.
   */
  put(blob: MediaResource): Promise<boolean>;

  /**
   * Transfers the blob to the azure storage.
   *
   * @param {MediaResource} blob The resource to transfer.
   * @returns {Promise<boolean>} {@code true} if successful.
   */
  spool(blob: MediaResource): Promise<boolean>;
}
