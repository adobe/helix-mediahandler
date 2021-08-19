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
const fse = require('fs-extra');
const path = require('path');
const nock = require('nock');
const { Scope } = require('nock/lib/scope');
const assert = require('assert');
const MediaHandler = require('../src/MediaHandler.js');
const { version } = require('../package.json');

const TEST_IMAGE = path.resolve(__dirname, 'fixtures', 'test_image.png');
const TEST_SMALL_IMAGE = path.resolve(__dirname, 'fixtures', 'test_small_image.png');
const TEST_IMAGE_URI = 'https://www.example.com/test_image.png';

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

describe('MediaHandler', () => {
  ['owner', 'repo', 'ref', 'contentBusId'].forEach((prop) => {
    it(`fails if no ${prop}`, async () => {
      const opts = {
        ...DEFAULT_OPTS,
        [prop]: '',
      };
      await assert.throws(() => new MediaHandler(opts), Error('owner, repo, ref, and contentBusId are mandatory parameters.'));
    });
  });

  it('uploads a test image to media-bus', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const scope1 = nock('https://www.example.com')
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

    const scope2 = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .s3Multipart({
        agent: `blobhandler-${version}`,
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
        agent: `blobhandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });

    scope1.done();
    scope2.done();
  });

  it('uploads a test image to media-bus using stream if too big', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      uploadBufferSize: 1024,
    });
    const testImage = await fse.readFile(TEST_IMAGE);
    const scope1 = nock('https://www.example.com')
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

    const scope2 = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .s3Multipart({
        agent: `blobhandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
      })
      .put('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4?x-id=CopyObject')
      .reply(function reply() {
        assert.strictEqual(this.req.headers['x-amz-metadata-directive'], 'REPLACE');
        assert.strictEqual(this.req.headers['x-amz-copy-source'], 'helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4');
        assert.deepStrictEqual(extractMeta(this.req.headers), {
          agent: `blobhandler-${version}`,
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
        agent: `blobhandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });

    scope1.done();
    scope2.done();
  });

  it('does not upload if already exists', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const scope1 = nock('https://www.example.com')
      .get('/test_image.png')
      .reply(206, testImage.slice(0, 8192), {
        'content-range': `bytes 0-8191/${testImage.length}`,
        'content-length': 8192,
      });

    const scope2 = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(200, '', {
        'x-amz-meta-alg': '8k',
        'x-amz-meta-agent': `blobhandler-${version}`,
        'x-amz-meta-src': 'https://www.example.com/test_image.png',
      });

    const resource = await handler.getBlob(TEST_IMAGE_URI);
    assert.deepStrictEqual(resource, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      lastModified: null,
      meta: {
        agent: `blobhandler-${version}`,
        alg: '8k',
        src: 'https://www.example.com/test_image.png',
      },
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });

    scope1.done();
    scope2.done();
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
        agent: `blobhandler-${version}`,
        alg: '8k',
        src: '',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: '',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
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
        agent: `blobhandler-${version}`,
        src: '',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      contentBusId: 'foo-id',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });
  });

  it('creates a media resource with prefix', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      namePrefix: 'ittest_',
    });
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage, testImage.length, 'image/png');
    assert.ok(blob.data);
    blob.data = null;
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/png',
      data: null,
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      meta: {
        agent: `blobhandler-${version}`,
        alg: '8k',
        src: '',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: '',
      storageKey: 'foo-id/ittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/ittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });
  });

  it('creates a media resource with no content type', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage, testImage.length, undefined, 'image.jpg');
    assert.ok(blob.data);
    blob.data = null;
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/jpeg',
      data: null,
      hash: '18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      meta: {
        agent: `blobhandler-${version}`,
        alg: '8k',
        src: 'image.jpg',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: 'image.jpg',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });
  });

  it('creates an external with small buffer', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage.slice(0, 1024), testImage.length, undefined, 'image.jpg');
    assert.ok(!blob.data);
    assert.deepStrictEqual(blob, {
      contentBusId: 'foo-id',
      contentLength: 143719,
      contentType: 'image/jpeg',
      data: null,
      hash: '1086c75d27ff7dba126e9fba302c402f07caa3822',
      meta: {
        agent: `blobhandler-${version}`,
        alg: '8k',
        src: 'image.jpg',
      },
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      sourceUri: 'image.jpg',
      storageKey: 'foo-id/1086c75d27ff7dba126e9fba302c402f07caa3822',
      storageUri: 's3://helix-media-bus/foo-id/1086c75d27ff7dba126e9fba302c402f07caa3822',
      uri: 'https://ref--repo--owner.hlx.live/media_1086c75d27ff7dba126e9fba302c402f07caa3822',
    });
  });

  it('returns null for a non existing resource', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);
    const scope = nock('https://www.example.com')
      .get('/404.png')
      .reply(404);

    const blob = await handler.getBlob('https://www.example.com/404.png', 'image/png');
    assert.strictEqual(blob, null);
    scope.done();
  });

  it('can specify timeout', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      fetchTimeout: 500,
    });

    const scope = nock('https://www.example.com')
      .get('/slow.png')
      .delay(1000)
      .reply(200);

    const blob = await handler.getBlob('https://www.example.com/slow.png', 'image/png');
    assert.strictEqual(blob, null);
    scope.done();
  });

  it('can upload an external resource', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testImage = await fse.readFile(TEST_IMAGE);
    const blob = handler.createMediaResource(testImage, 0, 'image/png');

    const scope = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .s3Multipart({
        alg: '8k',
        agent: 'blob-test',
        src: '',
        width: '477',
        height: '268',
      });
    assert.strictEqual(await handler.put(blob), true);

    scope.done();
  });

  it('can upload an external resource from stream', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 143719, 'image/png', 'https://www.foo.com');

    const scope = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .s3Multipart({
        alg: '8k',
        agent: 'blob-test',
        src: 'https://www.foo.com',
      });

    assert.strictEqual(await handler.put(blob), true);
    scope.done();
  });

  it('can upload a small external resource from stream', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');

    const scope = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .s3Multipart({
        alg: '8k',
        agent: 'blob-test',
        src: '',
      }, '14194ad0b7e2f6d345e3e8070ea9976b588a7d3bc');
    assert.strictEqual(await handler.put(blob), true);
    scope.done();
  });

  it('filter rejects blob', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      filter: (blob) => (blob.contentType.startsWith('image/')),
    });

    const scope = nock('https://embed.spotify.com')
      .get('/?uri=spotify:artist:4gzpq5DPGxSnKTe4SA8HAU')
      .reply(200, 'foo', {
        'content-type': 'text/html',
      });

    const blob = await handler.getBlob('https://embed.spotify.com/?uri=spotify:artist:4gzpq5DPGxSnKTe4SA8HAU');
    assert.strictEqual(blob, null);
    scope.done();
  });

  it('uploads a test image to media bus using name prefix', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      namePrefix: 'anotherittest_',
      blobAgent: 'blob-test',
    });

    const testImage = await fse.readFile(TEST_IMAGE);

    const scope1 = nock('https://www.example.com')
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

    const scope2 = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .s3Multipart({
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
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/anotherittest_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });

    scope1.done();
    scope2.done();
  });

  it('uses authentication header', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      auth: 'Bearer 1234',
    });

    const testImage = await fse.readFile(TEST_IMAGE);
    const scope1 = nock('https://www.example.com')
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

    const scope2 = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .head('/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4')
      .reply(404)
      .s3Multipart({
        agent: `blobhandler-${version}`,
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
        agent: `blobhandler-${version}`,
        alg: '8k',
        'source-last-modified': '01-01-2021',
        src: 'https://www.example.com/test_image.png',
        height: '268',
        width: '477',
      },
      originalUri: 'https://www.example.com/test_image.png',
      owner: 'owner',
      ref: 'ref',
      repo: 'repo',
      storageKey: 'foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      storageUri: 's3://helix-media-bus/foo-id/18bb2f0e55ff47be3fc32a575590b53e060b911f4',
      uri: 'https://ref--repo--owner.hlx.live/media_18bb2f0e55ff47be3fc32a575590b53e060b911f4',
    });

    scope1.done();
    scope2.done();
  });

  it('can update metadata', async () => {
    const handler = new MediaHandler({
      ...DEFAULT_OPTS,
      blobAgent: 'blob-test',
    });

    const testStream = fse.createReadStream(TEST_SMALL_IMAGE);
    const blob = await handler.createMediaResourceFromStream(testStream, 613, 'image/png');
    blob.meta.src = '/some-source';

    const scope = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .s3Multipart({
        alg: '8k',
        agent: 'blob-test',
        src: '/some-source',
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
        });
        return [200, '<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>\\n<CopyObjectResult xmlns=\\"http://s3.amazonaws.com/doc/2006-03-01/\\"><LastModified>2021-05-05T08:37:23.000Z</LastModified><ETag>&quot;f278c0035a9b4398629613a33abe6451&quot;</ETag></CopyObjectResult>'];
      })
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

    assert.deepStrictEqual(await handler.put(blob), true);
    blob.meta.foo = 'hello, world.';
    await handler.putMetaData(blob);
    scope.done();
  });

  it('sanitizes content type', () => {
    assert.equal(MediaHandler.sanitizeContentType(undefined), undefined);
    assert.equal(MediaHandler.sanitizeContentType(''), '');
    assert.equal(MediaHandler.sanitizeContentType('image/jpg'), 'image/jpeg');
    assert.equal(MediaHandler.sanitizeContentType('image/JPEG'), 'image/jpeg');
    assert.equal(MediaHandler.sanitizeContentType('image/JPEG;charset=utf-8'), 'image/jpeg');
    assert.equal(MediaHandler.sanitizeContentType('image/gif ; charset=utf-8'), 'image/gif');
    assert.equal(MediaHandler.sanitizeContentType('image/gif ; q=.7'), 'image/gif;q=.7');
    assert.equal(MediaHandler.sanitizeContentType('image/png ; charset=utf-8'), 'image/png');
    assert.equal(MediaHandler.sanitizeContentType('  application/octet-stream ; charset=utf-8'), 'application/octet-stream');
    assert.equal(MediaHandler.sanitizeContentType('text/html;charset=UTF-8'), 'text/html;charset=utf-8');
  });
});
