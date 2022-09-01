/*
 * Copyright 2022 Adobe. All rights reserved.
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
import crypto from 'crypto';
import nock from 'nock';
import yazl from 'yazl';
import processQueue from '@adobe/helix-shared-process-queue';
import { Scope } from 'nock/lib/scope.js';

import assert from 'assert';
import MediaHandler from '../src/MediaHandler.js';
import { openArrayBuffer as mammothZipFile } from './zipfile.js';

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

/**
 * Add custom scope interceptor chain for multipart uploads
 */
Scope.prototype.putObject = function putObject(expectedMeta, sha = '18bb2f0e55ff47be3fc32a575590b53e060b911f4') {
  return this.put(`/foo-id/${sha}?x-id=PutObject`)
    .reply(function reply() {
      assert.deepStrictEqual(extractMeta(this.req.headers), expectedMeta);
      return [201];
    });
};

describe('Upload from Zip', () => {
  it('uploads a test images from a zip file', async () => {
    const handler = new MediaHandler(DEFAULT_OPTS);

    // construct zip file
    const zipfile = new yazl.ZipFile();
    const images = {};
    for (let i = 0; i < 100; i += 1) {
      const size = 1024 + Math.floor(Math.random() * 8192);
      const img = {
        name: `image${i}`,
        size,
        buffer: crypto.randomBytes(size),
      };
      images[img.name] = img;
      zipfile.addBuffer(img.buffer, img.name);
    }
    zipfile.end();
    const tmpBuffers = [];
    for await (const data of zipfile.outputStream) {
      tmpBuffers.push(data);
    }
    const zipBuffer = Buffer.concat(tmpBuffers);
    const zip = await mammothZipFile(zipBuffer);

    const imgByUri = {};

    const scope = nock('https://helix-media-bus.s3.us-east-1.amazonaws.com')
      .put(/.*/)
      .reply((uri, body) => {
        // console.log(uri);
        const expected = imgByUri[uri];
        if (!expected) {
          throw Error(`image no found: ${uri}`);
        }
        const buf = Buffer.from(body, 'hex');
        if (buf.size === 0) {
          throw Error('empty buffer');
        }
        return [201];
      })
      .persist();
    await processQueue(Object.values(images), async (img) => {
      const { stream } = await zip.read(img.name, null, true);
      const blob = await handler.createMediaResourceFromStream(stream, img.size, 'image/png', img.name);
      // eslint-disable-next-line no-param-reassign
      img.blob = blob;
      imgByUri[`/foo-id/${blob.hash}?x-id=PutObject`] = img;
      await handler.upload(blob);
    });

    // console.log(images);

    scope.done();
  }).timeout(60000);
});
