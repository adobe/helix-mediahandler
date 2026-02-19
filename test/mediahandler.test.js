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

/* eslint-env mocha */
import fse from 'fs-extra';
import path from 'path';
import xml2js from 'xml2js';
import { Scope } from 'nock/lib/scope.js';

import assert from 'assert';
import MediaHandler from '../src/MediaHandler.js';
import pkgJson from '../src/package.cjs';
import { Nock } from './utils.js';
import { maxSizeMediaFilter, SizeTooLargeException } from '../src/index.js';

const { version } = pkgJson;

const TEST_IMAGE = path.resolve(__rootdir, 'test', 'fixtures', 'test_image.png');
const TEST_SMALL_IMAGE = path.resolve(__rootdir, 'test', 'fixtures', 'test_small_image.png');
const TEST_IMAGE_URI = 'https://www.example.com/test_image.png';

const TEST_VIDEO = path.resolve(__rootdir, 'test', 'fixtures', 'test_video.mp4');
const TEST_VIDEO_URI = 'https://www.example.com/test_video.mp4';

// require('dotenv').config();
const DEFAULT_OPTS = {
  owner: 'owner',
  repo: 'repo',
  ref: 'ref',
  contentBusId: 'foo-id',
  forceHttp1: true,
  noCache: true,
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'fake',
  awsSecretAccessKey: 'fake',
  r2AccountId: 'fake',
  r2AccessKeyId: 'fake',
  r2SecretAccessKey: 'fake',
};

function extractMeta(hdrs) {
  return Object
    .keys(hdrs)
    .filter((key) => (key.startsWith('x-amz-meta-')))
    .reduce((prev, key) => ({ ...prev, [key.substring(11)]: hdrs[key] }), {});
}

/**
 * Add custom scope interceptor chain for multipart uploads
 */
Scope.prototype.s3Multipart = function s3Multipart(expectedMeta, sha = '18bb2f0e55ff47be3fc32a575590b53e060b911f4') {
  return this.post(`/foo-id/${sha}?uploads=&x-id=CreateMultipartUpload`)
    .reply(function reply() {
      assert.deepStrictEqual(extractMeta(this.req.headers), expectedMeta);
      return [200, `<?xml version="1.0" encoding="UTF-8"?>
                    <InitiateMultipartUploadResult>
                       <Bucket>helix-media-bus</Bucket>
                       <Key>foo-id/${sha}</Key>
                       <UploadId>0</UploadId>
                    </InitiateMultipartUploadResult>`,
      ];
    })
    .post(`/foo-id/${sha}?uploadId=0&x-id=CompleteMultipartUpload`)
    .reply(200, `<?xml version="1.0" encoding="UTF-8"?>
                <CompleteMultipartUploadResult>
                   <Location>https://helix-media-bus.s3.us-east-1.amazonaws.com/foo-id/${sha}</Location>
                   <Bucket>helix-media-bus</Bucket>
                   <Key>foo-id/${sha}</Key>
                   <ETag>string</ETag>
                </CompleteMultipartUploadResult>`);
};

/**
 * Add custom scope interceptor chain for multipart uploads
 */
Scope.prototype.putObject = function putObject(expectedMeta, sha = '18bb2f0e55ff47be3fc32a575590b53e060b911f4', contentBusId = 'foo-id') {
  return this
    .put(`/${contentBusId}/${sha}?x-id=PutObject`)
    .reply(function reply() {
      assert.deepStrictEqual(extractMeta(this.req.headers), expectedMeta);
      return [201];
    });
};

describe('MediaHandler', () => {
  let nock;
  beforeEach(() => {
    nock = new Nock().env();
  });

  afterEach(() => {
    nock.done();
  });

  ['owner', 'repo', 'ref', 'contentBusId'].forEach((prop) => {
    it(`fails if no ${prop}`, async () => {
      const opts = {
        ...DEFAULT_OPTS,
        [prop]: '',
      };
      await assert.throws(() => new MediaHandler(opts), Error('owner, repo, ref, and contentBusId are mandatory parameters.'));
    });
  });

  it('creates S3Client without credentials', async () => {
    const opts = { ...DEFAULT_OPTS };
    ['awsRegion', 'awsAccessKeyId', 'awsSecretAccessKey'].forEach((k) => delete opts[k]);

    assert.doesNotThrow(() => new MediaHandler(opts));
  });

  it('tracks existing blobs via checkBlobExists (uploaded=false)', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);

    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
        'content-type': 'image/png',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(200, '', {
        'x-amz-meta-src': 'https://www.example.com/test_image.png',
        'x-amz-meta-width': '477',
        'x-amz-meta-height': '268',
      });

    // clear any previous tracking
    handler.clearUploadedImages();

    const blob = await handler.getBlob('https://www.example.com/test_image.png');

    assert.ok(blob);
    assert.strictEqual(blob.uri, 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268');

    const uploadedImages = handler.getUploadedImages();
    assert.strictEqual(uploadedImages.length, 1);
    assert.deepStrictEqual(uploadedImages[0], {
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      contentType: 'image/png',
      width: '477',
      height: '268',
      originalUri: 'https://www.example.com/test_image.png',
      uploaded: false,
    });

    // verify clearUploadedImages works
    handler.clearUploadedImages();
    assert.strictEqual(handler.getUploadedImages().length, 0);
  });

  it('tracks blobs automatically via low-level APIs (simulating docx2md flow)', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);

    // Simulate docx2md flow: createMediaResource -> checkBlobExists -> upload
    const blob = handler.createMediaResource(testImage, testImage.length, 'image/png', 'https://source.com/doc.docx');

    // Mock: blob doesn't exist
    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        src: 'https://source.com/doc.docx',
      });

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        src: 'https://source.com/doc.docx',
      });

    handler.clearUploadedImages();

    const exists = await handler.checkBlobExists(blob);
    assert.strictEqual(exists, false);
    // Not tracked yet since it doesn't exist
    assert.strictEqual(handler.getUploadedImages().length, 0);

    await handler.upload(blob);

    // Now it should be tracked as uploaded
    const uploadedImages = handler.getUploadedImages();
    assert.strictEqual(uploadedImages.length, 1);
    assert.strictEqual(uploadedImages[0].uploaded, true);
    assert.strictEqual(uploadedImages[0].hash, '18bb2f0e55ff47be3fc32a575590b53e060b911f4');
  });

  it('tracks existing blobs via low-level checkBlobExists (simulating docx2md flow)', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);

    // Simulate docx2md flow where blob already exists
    const blob = handler.createMediaResource(testImage, testImage.length, 'image/png');

    // Mock: blob exists
    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(200, '', {
        'x-amz-meta-width': '477',
        'x-amz-meta-height': '268',
      });

    handler.clearUploadedImages();

    const exists = await handler.checkBlobExists(blob);
    assert.strictEqual(exists, true);

    // Should be tracked as not uploaded (already existed)
    const uploadedImages = handler.getUploadedImages();
    assert.strictEqual(uploadedImages.length, 1);
    assert.strictEqual(uploadedImages[0].uploaded, false);
  });

  it('tracks cached images from previous session as not uploaded', async () => {
    // Use a unique contentBusId for this test to avoid interference
    const testContentBusId = 'cached-image-test-id';
    const testOpts = {
      ...DEFAULT_OPTS,
      contentBusId: testContentBusId,
      noCache: false, // enable caching
    };

    const testImage = await fse.readFile(TEST_IMAGE);

    // First handler fetches and caches the image
    const handler1 = new MediaHandler(testOpts);

    nock('https://www.example.com')
      .get('/cached_test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
        'content-type': 'image/png',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head(`/${testContentBusId}/18bb2f0e55ff47be3fc32a575590b53e060b911f4`)
      .reply(200, '', {
        'x-amz-meta-src': 'https://www.example.com/cached_test_image.png',
        'x-amz-meta-width': '477',
        'x-amz-meta-height': '268',
      });

    const blob1 = await handler1.getBlob('https://www.example.com/cached_test_image.png');
    assert.ok(blob1);
    assert.strictEqual(handler1.getUploadedImages().length, 1);

    // Second handler (simulating a new session) - has empty _uploadedImages but shares the cache
    const handler2 = new MediaHandler(testOpts);

    // No nock needed - should hit the cache from handler1
    const blob2 = await handler2.getBlob('https://www.example.com/cached_test_image.png');
    assert.ok(blob2);
    assert.strictEqual(blob2.hash, blob1.hash);

    // Verify the cached image is tracked with uploaded: false
    const uploadedImages = handler2.getUploadedImages();
    assert.strictEqual(uploadedImages.length, 1);
    assert.deepStrictEqual(uploadedImages[0], {
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      contentType: 'image/png',
      width: '477',
      height: '268',
      originalUri: 'https://www.example.com/cached_test_image.png',
      uploaded: false, // cached from previous session
    });
  });

  it('creating a media resource from stream without content length should throw', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    await assert.rejects(
      async () => handler.createMediaResourceFromStream(testStream, undefined, 'image/png'),
      /createExternalResourceFromStream\(\) needs contentLength/,
    );
  });

  it('creating a media resource from empty buffer without content length should throw', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    await assert.throws(
      () => handler.createMediaResource(Buffer.from([]), 0),
      new Error('createExternalResource() needs contentLength or non-empty buffer'),
    );
  });

  it('uploads a test image to media-bus', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      })
      .get('/test_image.png')
      // eslint-disable-next-line prefer-arrow-callback
      .reply(function cb() {
        assert.strictEqual(this.req.headers.accept, 'image/jpeg,image/jpg,image/png,image/gif,video/mp4,application/xml,image/x-icon,image/avif,image/webp,*/*;q=0.8');
        assert.strictEqual(this.req.headers['accept-encoding'], 'identity');
        return [200, testImage, {
          'content-length': testImage.length,
          'content-type': 'image/png',
          'last-modified': '01-01-2021',
        }];
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      });

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      });

    const resource = await handler.getBlob(TEST_IMAGE_URI);
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: '01-01-2021',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      uploaded: true,
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('uploads a test image to media-bus (head error)', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      })
      .get('/test_image.png')
      // eslint-disable-next-line prefer-arrow-callback
      .reply(function cb() {
        assert.strictEqual(this.req.headers.accept, 'image/jpeg,image/jpg,image/png,image/gif,video/mp4,application/xml,image/x-icon,image/avif,image/webp,*/*;q=0.8');
        assert.strictEqual(this.req.headers['accept-encoding'], 'identity');
        return [200, testImage, {
          'content-length': testImage.length,
          'content-type': 'image/png',
          'last-modified': '01-01-2021',
        }];
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .replyWithError('kaputt')
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      });

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '477',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      });

    const resource = await handler.getBlob(TEST_IMAGE_URI);
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: '01-01-2021',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      uploaded: true,
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('uploads a test video to media-bus', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testVideo = await fse.readFile(TEST_VIDEO);
    nock('https://www.example.com')
      .get('/test_video.mp4')
      .reply(206, testVideo.subarray(0, 8192), {
        'content-range': `bytes 0-8191/${testVideo.length}`,
        'content-length': 8192,
      })
      .get('/test_video.mp4')
      .reply(200, testVideo, {
        'content-length': testVideo.length,
        'content-type': 'video/mp4',
        'last-modified': '01-01-2021',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/122d57f2fc8e69edd784262ae09510ce81b2e0902')
      .reply(404)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '360',
        height: '640',
        duration: '3',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_video.mp4',
      }, '122d57f2fc8e69edd784262ae09510ce81b2e0902');

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        width: '360',
        height: '640',
        duration: '3',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_video.mp4',
      }, '122d57f2fc8e69edd784262ae09510ce81b2e0902');

    const resource = await handler.getBlob(TEST_VIDEO_URI);
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 108996,
      contentType: 'video/mp4',
      hash: '122d57f2fc8e69edd784262ae09510ce81b2e0902',
      lastModified: '01-01-2021',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_video.mp4',
        width: '360',
        height: '640',
        duration: '3',
      },
      uploaded: true,
      originalUri: 'https://www.example.com/test_video.mp4',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/122d57f2fc8e69edd784262ae09510ce81b2e0902',
      storageUri: 's3://helix-media-bus/foo-id/122d57f2fc8e69edd784262ae09510ce81b2e0902',
      uri: 'https://ref--repo--owner.aem.page/media_122d57f2fc8e69edd784262ae09510ce81b2e0902.mp4',
    });
  });

  it('uploads a test image to media-bus using stream if too big', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      uploadBufferSize: 1024,
    });
    const testImage = await fse.readFile(TEST_IMAGE);
    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      })
      .get('/test_image.png')
      .reply(200, testImage, {
        'content-length': testImage.length,
        'content-type': 'image/png',
        'last-modified': '01-01-2021',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      })
      .put('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          agent: `mediahandler-${version}`,
          alg: '8k',
          height: '268',
          'source-last-modified': '01-01-2021',
          src: 'https://www.example.com/test_image.png',
          width: '477',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      })
      .put('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          agent: `mediahandler-${version}`,
          alg: '8k',
          height: '268',
          'source-last-modified': '01-01-2021',
          src: 'https://www.example.com/test_image.png',
          width: '477',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });

    const resource = await handler.getBlob(TEST_IMAGE_URI);
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: '01-01-2021',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      uploaded: true,
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('does not upload if already exists', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(301, '', {
        location: 'https://www.example.com/real_image.png',
      })
      .get('/real_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(200, '', {
        'x-amz-meta-alg': '8k',
        'x-amz-meta-agent': `mediahandler-${version}`,
        'x-amz-meta-src': 'https://www.example.com/test_image.png',
        'x-amz-meta-width': '477',
        'x-amz-meta-height': '268',
      });

    const resource = await handler.getBlob(TEST_IMAGE_URI, 'test_image.png');
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: null,
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      uploaded: false,
      originalUri: 'https://www.example.com/real_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('creates a media resource', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage, testImage.length, 'image/png');
    assert.ok(blob.data);
    blob.data = null;
    assert.deepEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      data: null,
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        src: '',
        height: '268',
        width: '477',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: '',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('creates a media resource from stream', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testStream = fse.createReadStream(TEST_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 143719, 'image/png');
    assert.ok(blob.stream);
    delete blob.stream;
    assert.deepStrictEqual(blob, {
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      sourceUri: '',
      meta: {
        alg: '8k',
        agent: `mediahandler-${version}`,
        src: '',
        height: '268',
        width: '477',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      contentBusId: 'foo-id',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('handles corrupt stream', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testStream = fse.createReadStream('foobar-does-not-exist');
    const task = handler.createMediaResourceFromStream(testStream, 143719, 'image/png');
    await assert.rejects(task, Error('Error reading stream: ENOENT'));
  });

  it('creates a media resource with prefix', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      namePrefix: 'ittest_',
    });
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage);
    assert.ok(blob.data);
    blob.data = null;
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      data: null,
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        src: '',
        height: '268',
        width: '477',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: '',
      storageKey: 'foo-id/ittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/ittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });
  });

  it('creates a media resource with no content type', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = Buffer.from('foo bar');
    const blob = handler.createMediaResource(testImage, testImage.length, undefined, 'image.jpg');
    assert.ok(blob.data);
    blob.data = null;
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 7,
      contentType: 'image/jpeg',
      data: null,
      hash: '1ba15914a0844f8fcdf49e359df0a2f0bec208613',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        src: 'image.jpg',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: 'image.jpg',
      storageKey: 'foo-id/1ba15914a0844f8fcdf49e359df0a2f0bec208613',
      storageUri: 's3://helix-media-bus/foo-id/1ba15914a0844f8fcdf49e359df0a2f0bec208613',
      uri: 'https://ref--repo--owner.aem.page/media_1ba15914a0844f8fcdf49e359df0a2f0bec208613.jpg',
    });
  });

  it('creates an external with small buffer', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage.slice(0, 1024), testImage.length, undefined, 'image.png');
    assert.ok(!blob.data);
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      data: null,
      hash: '1086c75d27ff7dba126e9fba302c402f07caa3822',
      meta: {
        agent: `mediahandler-${version}`,
        alg: '8k',
        src: 'image.png',
        height: '268',
        width: '477',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: 'image.png',
      storageKey: 'foo-id/1086c75d27ff7dba126e9fba302c402f07caa3822',
      storageUri: 's3://helix-media-bus/foo-id/1086c75d27ff7dba126e9fba302c402f07caa3822',
      uri: 'https://ref--repo--owner.aem.page/media_1086c75d27ff7dba126e9fba302c402f07caa3822.png#width=477&height=268',
    });
  });

  it('returns null for a non existing resource', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    nock('https://www.example.com')
      .get('/404.png')
      .reply(404);

    const blob = await handler.getBlob('https://www.example.com/404.png', 'image/png');
    assert.strictEqual(blob, null);
  });

  it('retries for a resource returning a 500 first', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_SMALL_IMAGE);
    nock('https://www.example.com')
      .get('/test_small_image.png')
      .reply(500)
      .get('/test_small_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': 'bytes 0-8191/whoopsie',
        'content-length': 8192,
      });

    await handler.fetchHeader('https://www.example.com/test_small_image.png');
  });

  it('can specify timeout', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      fetchTimeout: 500,
    });

    nock('https://www.example.com')
      .get('/slow.png')
      .delay(1000)
      .reply(200);

    const blob = await handler.getBlob('https://www.example.com/slow.png', 'image/png');
    assert.strictEqual(blob, null);
  });

  it('can upload an external resource', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage, 0, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        width: '477',
        src: '',
        height: '268',
      });

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        width: '477',
        src: '',
        height: '268',
      });

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('can upload an external resource from stream', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 143719, 'image/png', 'https://www.foo.com');
    delete blob.meta.width;
    delete blob.meta.height;

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: 'https://www.foo.com',
      })
      .put('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4');
        assert.strictEqual(this.req.headers['content-type'], 'image/png');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          agent: 'blob-test',
          alg: '8k',
          src: 'https://www.foo.com',
          width: '477',
          height: '268',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: 'https://www.foo.com',
      })
      .put('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          agent: 'blob-test',
          alg: '8k',
          src: 'https://www.foo.com',
          width: '477',
          height: '268',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });
    assert.strictEqual(await handler.upload(blob), true);
  });

  it('can upload a small external resource from stream', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        src: '',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        src: '',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('rejects deprecated maxSize option', async () => {
    const create = async () => new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      maxSize: 256,
    });
    await assert.rejects(create, Error('maxSize is no longer supported. use a maxSizeMediaFilter instead.'));
  });

  it('rejects resource that exceeds the allowed size limit via getBlob (filter)', async () => {
    const testImage = await fse.readFile(TEST_IMAGE);

    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      filter: maxSizeMediaFilter(256), // image is ~60KB, so this should reject
    });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404);

    nock('https://www.example.com')
      .get('/large_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
        'content-type': 'image/png',
      });

    await assert.rejects(
      handler.getBlob('https://www.example.com/large_image.png'),
      (err) => err instanceof SizeTooLargeException && err.message.includes('Resource size exceeds allowed limit'),
    );
  });

  it('filter can return content filter if data is missing', async () => {
    const testImage = await fse.readFile(TEST_IMAGE);

    const contentFilter = (blob) => {
      assert.strictEqual(!!blob.data, true);
      return false;
    };

    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      filter: (blob) => {
        assert.strictEqual(blob.data, undefined);
        return contentFilter;
      },
    });

    nock('https://www.example.com')
      .get('/test.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
        'content-type': 'image/png',
      })
      .get('/test.png')
      .reply(200, testImage, {
        'content-length': testImage.length,
        'content-type': 'image/png',
      });
    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404);

    const blob = await handler.getBlob('https://www.example.com/test.png');
    assert.strictEqual(blob, null);
  });

  it('content filter can throw exception after receiving data', async () => {
    const testImage = await fse.readFile(TEST_IMAGE);

    const contentFilter = (blob) => {
      assert.strictEqual(!!blob.data, true);
      throw new Error('kaputt');
    };

    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      filter: () => contentFilter,
    });

    nock('https://www.example.com')
      .get('/test.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
        'content-type': 'image/png',
      })
      .get('/test.png')
      .reply(200, testImage, {
        'content-length': testImage.length,
        'content-type': 'image/png',
      });
    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404);

    await assert.rejects(handler.getBlob('https://www.example.com/test.png'), new Error('kaputt'));
  });

  it('can upload a small external resource from stream with S3 failing', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=PutObject')
      .times(3)
      .reply(500, 'that went wrong');
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        width: '58',
        src: '',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), false);
  });

  it('can upload a small external resource from stream with R2 failing', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        width: '58',
        src: '',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=PutObject')
      .times(3)
      .reply(500, 'that went wrong');

    assert.strictEqual(await handler.upload(blob), false);
  });

  it('can upload a blob from a small image', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testImage = await fse.readFile(TEST_SMALL_IMAGE);
    const blob = handler.createMediaResource(testImage, testImage.length, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        width: '58',
        src: '',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        width: '58',
        src: '',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('can disable R2 via options', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      disableR2: true,
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        src: '',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('can disable R2 via env (HELIX_MEDIA_HANDLER_DISABLE_R2)', async () => {
    process.env.HELIX_MEDIA_HANDLER_DISABLE_R2 = 'true';
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        src: '',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('can disable R2 via env (HELIX_STORAGE_DISABLE_R2)', async () => {
    process.env.HELIX_STORAGE_DISABLE_R2 = 'true';
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        height: '74',
        src: '',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');

    assert.strictEqual(await handler.upload(blob), true);
  });

  it('filter rejects blob', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      filter: (blob) => (blob.contentType.startsWith('image/')),
    });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/13fa0fadacc274ce164322576cf043a25379d00f7')
      .reply(404);

    nock('https://embed.spotify.com')
      .get('/?uri=spotify:artist:4gzpq5DPGxSnKTe4SA8HAU')
      .reply(200, 'foo', {
        'content-type': 'text/html',
      });

    const blob = await handler.getBlob('https://embed.spotify.com/?uri=spotify:artist:4gzpq5DPGxSnKTe4SA8HAU');
    assert.strictEqual(blob, null);
  });

  it('filter can throw exception', async () => {
    const testImage = await fse.readFile(TEST_SMALL_IMAGE);

    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      filter: () => {
        throw new Error('kaputt');
      },
    });
    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .reply(404);

    nock('https://www.example.com')
      .get('/test.png')
      .reply(200, testImage.slice(0, 8192), {
        'content-length': testImage.length,
        'content-type': 'image/png',
      });

    await assert.rejects(handler.getBlob('https://www.example.com/test.png'), new Error('kaputt'));
  });

  it('uploads a test image to media bus using name prefix', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      namePrefix: 'anotherittest_',
      blobAgent: 'blob-test',
      noCache: false,
    });

    const testImage = await fse.readFile(TEST_IMAGE);

    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      })
      .get('/test_image.png')
      .reply(200, testImage, {
        'content-length': testImage.length,
        'content-type': 'image/png',
        'last-modified': '01-01-2021',
        'x-ms-meta-name': 'whoopsie',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .putObject({
        agent: 'blob-test',
        alg: '8k',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        width: '477',
      }, 'anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4');

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: 'blob-test',
        alg: '8k',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        width: '477',
      }, 'anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4');

    const resource = await handler.getBlob(TEST_IMAGE_URI);
    assert.deepEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: '01-01-2021',
      meta: {
        agent: 'blob-test',
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      uploaded: true,
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
    });

    const resource2 = await handler.getBlob(TEST_IMAGE_URI);
    assert.strictEqual(resource.hash, resource2.hash);

    // now upload the same image to a different media bus

    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      })
      .get('/test_image.png')
      .reply(200, testImage, {
        'content-length': testImage.length,
        'content-type': 'image/png',
        'last-modified': '01-01-2021',
        'x-ms-meta-name': 'whoopsie',
      });

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id-2/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .putObject({
        agent: 'blob-test',
        alg: '8k',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        width: '477',
      }, 'anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4', 'foo-id-2');

    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        agent: 'blob-test',
        alg: '8k',
        height: '268',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        width: '477',
      }, 'anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4', 'foo-id-2');

    // upload 2nd blob with different contentBusId
    const handler2 = new MediaHandler({
      ...DEFAULT_OPTS,
      contentBusId: 'foo-id-2',
      namePrefix: 'anotherittest_',
      blobAgent: 'blob-test',
      noCache: false,
    });

    const resource3 = await handler2.getBlob(TEST_IMAGE_URI);
    assert.strictEqual(resource.hash, resource3.hash);
  });

  for (const { auth, title } of [
    { auth: 'Bearer 1234', title: 'property' },
    { auth: () => 'Bearer 1234', title: 'function' },
  ]) {
    // eslint-disable-next-line no-loop-func
    it(`uses authentication header via ${title}`, async () => {
      const handler = new MediaHandler({
        ...DEFAULT_OPTS,
        auth,
      });

      const testImage = await fse.readFile(TEST_IMAGE);
      nock('https://www.example.com')
        .get('/test_image.png')
        .matchHeader('authorization', 'Bearer 1234')
        .reply(206, testImage.slice(0, 8192), {
          'content-range': `bytes 0-8192/${testImage.length}`,
          'content-length': 8192,
        })
        .get('/test_image.png')
        .matchHeader('authorization', 'Bearer 1234')
        .reply(200, testImage, {
          'content-length': testImage.length,
          'content-type': 'image/png',
          'last-modified': '01-01-2021',
        });

      nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
        .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
        .reply(404)
        .putObject({
          agent: `mediahandler-${version}`,
          alg: '8k',
          height: '268',
          'source-last-modified': '01-01-2021',
          src: 'https://www.example.com/test_image.png',
          width: '477',
        });

      nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
        .putObject({
          agent: `mediahandler-${version}`,
          alg: '8k',
          height: '268',
          'source-last-modified': '01-01-2021',
          src: 'https://www.example.com/test_image.png',
          width: '477',
        });

      const resource = await handler.getBlob(TEST_IMAGE_URI);
      assert.deepStrictEqual(resource, {
        contentBusId: 'foo-id',
        contentLength: 143719,
        contentType: 'image/png',
        hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
        lastModified: '01-01-2021',
        meta: {
          agent: `mediahandler-${version}`,
          alg: '8k',
          'source-last-modified': '01-01-2021',
          src: 'https://www.example.com/test_image.png',
          height: '268',
          width: '477',
        },
        uploaded: true,
        originalUri: 'https://www.example.com/test_image.png',
        owner: 'owner',
        ref: 'ref',
        repo: 'repo',
        storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
        storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
        uri: 'https://ref--repo--owner.aem.page/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4.png#width=477&height=268',
      });
    });
  }

  it('can update metadata', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');
    blob.meta.src = '/some-source';

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          alg: '8k',
          agent: 'blob-test',
          src: '/some-source',
          width: '58',
          height: '74',
          foo: 'hello, world.',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          alg: '8k',
          agent: 'blob-test',
          src: '/some-source',
          width: '58',
          height: '74',
          foo: 'hello, world.',
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      });

    assert.deepStrictEqual(await handler.upload(blob), true);
    blob.meta.foo = 'hello, world.';
    await handler.putMetaData(blob);
  });

  it('can update metadata (with R2 disabled)', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
      disableR2: true,
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');
    blob.meta.src = '/some-source';

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          alg: '8k',
          agent: 'blob-test',
          src: '/some-source',
          width: '58',
          height: '74',
          foo: 'hello, world.',
        });
        return [200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '1985-04-12T23:20:50.52Z',
            ETag: '"f278c0035a9b4398629613a33abe6451";',
          },
        })];
      });

    assert.deepStrictEqual(await handler.upload(blob), true);
    blob.meta.foo = 'hello, world.';
    await handler.putMetaData(blob);
  });

  it('can update metadata with S3 failing', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');
    blob.meta.src = '/some-source';

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .times(3)
      .reply(500, 'that went wrong');
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          alg: '8k',
          agent: 'blob-test',
          src: '/some-source',
          width: '58',
          height: '74',
          foo: 'hello, world.',
        });
        return [200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '1985-04-12T23:20:50.52Z',
            ETag: '"f278c0035a9b4398629613a33abe6451";',
          },
        })];
      });

    assert.deepStrictEqual(await handler.upload(blob), true);
    blob.meta.foo = 'hello, world.';
    await handler.putMetaData(blob);
  });

  it('can update metadata with R2 failing', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');
    blob.meta.src = '/some-source';

    nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          alg: '8k',
          agent: 'blob-test',
          src: '/some-source',
          width: '58',
          height: '74',
          foo: 'hello, world.',
        });
        return [200, new xml2js.Builder().buildObject({
          CopyObjectResult: {
            LastModified: '1985-04-12T23:20:50.52Z',
            ETag: '"f278c0035a9b4398629613a33abe6451";',
          },
        })];
      });
    nock(`https://helix-media-bus.${DEFAULT_OPTS.r2AccountId}.r2.cloudflarestorage.com`)
      .putObject({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
        height: '74',
        width: '58',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc')
      .put('/foo-id/14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc?x-id=CopyObject')
      .times(3)
      .reply(500, 'that went wrong');

    assert.deepStrictEqual(await handler.upload(blob), true);
    blob.meta.foo = 'hello, world.';
    await handler.putMetaData(blob);
  });

  it('can handle a bad content-range header', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
    });
    const testImage = await fse.readFile(TEST_SMALL_IMAGE);
    nock('https://www.example.com')
      .get('/test_small_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': 'bytes 0-8191/whoopsie',
        'content-length': 8192,
      });
    await handler.fetchHeader('https://www.example.com/test_small_image.png');
  });

  it('fetchHeader includes correct accept header', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
    });
    nock('https://www.example.com')
      .get('/test_small_image.png')
      .matchHeader('accept', 'image/jpeg,image/jpg,image/png,image/gif,video/mp4,application/xml,image/x-icon,image/avif,image/webp,*/*;q=0.8')
      .reply(200);
    await handler.fetchHeader('https://www.example.com/test_small_image.png');
  });

  it('aborts spool if fetch fails', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
    });
    nock('https://www.example.com')
      .get('/test_image.png')
      .reply(404, 'nope, not here');

    assert.strictEqual(false, await handler.upload({ originalUri: TEST_IMAGE_URI }));
  });

  it('sanitizes content type', () => {
    assert.strictEqual(MediaHandler.sanitizeContentType(undefined), undefined);
    assert.strictEqual(MediaHandler.sanitizeContentType(''), '');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/jpg'), 'image/jpeg');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/JPEG'), 'image/jpeg');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/JPEG;charset=utf-8'), 'image/jpeg');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/gif ; charset=utf-8'), 'image/gif');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/gif ; q=.7'), 'image/gif;q=.7');
    assert.strictEqual(MediaHandler.sanitizeContentType('image/png ; charset=utf-8'), 'image/png');
    assert.strictEqual(MediaHandler.sanitizeContentType('  application/octet-stream ; charset=utf-8'), 'application/octet-stream');
    assert.strictEqual(MediaHandler.sanitizeContentType('text/html;charset=UTF-8'), 'text/html;charset=utf-8');
  });

  it('uses best content type', () => {
    assert.strictEqual(MediaHandler.getContentType(), 'application/octet-stream');
    assert.strictEqual(MediaHandler.getContentType('image/jpg', 'image/png', 'baz.jpg'), 'image/jpg');
    assert.strictEqual(MediaHandler.getContentType('', 'image/png', 'baz.jpg'), 'image/png');
    assert.strictEqual(MediaHandler.getContentType('application/octet-stream', '', 'baz.png'), 'image/png');
  });
});
