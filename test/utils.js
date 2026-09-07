/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import assert from 'node:assert';
import nock from 'nock';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Bucket, MirroringBackend } from '@adobe/helix-shared-storage';
import { S3Backend } from '@adobe/helix-shared-storage-s3';

export function Nock() {
  const scopes = {};

  let unmatched;

  let savedEnv;

  function noMatchHandler(req) {
    unmatched.push(req);
  }

  function nocker(url) {
    let scope = scopes[url];
    if (!scope) {
      scope = nock(url);
      scopes[url] = scope;
    }
    if (!unmatched) {
      unmatched = [];
      nock.emitter.on('no match', noMatchHandler);
    }
    nock.disableNetConnect();
    return scope;
  }

  nocker.env = (overrides = {}) => {
    savedEnv = { ...process.env };
    Object.assign(process.env, {
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'dummy-id',
      AWS_SECRET_ACCESS_KEY: 'dummy-key',
      ...overrides,
    });
    return nocker;
  };

  nocker.done = () => {
    if (savedEnv) {
      process.env = savedEnv;
    }

    if (unmatched) {
      assert.deepStrictEqual(unmatched.map((req) => req.options || req), []);
      nock.emitter.off('no match', noMatchHandler);
    }
    try {
      Object.values(scopes).forEach((s) => s.done());
    } finally {
      nock.cleanAll();
    }
  };

  return nocker;
}

/**
 * Builds a `Bucket` (from `@adobe/helix-shared-storage`) wired against fake, static test
 * credentials for `helix-media-bus` and its R2 mirror, matching the `nock`-mocked endpoints
 * used throughout `mediahandler.test.js`.
 *
 * Constructs the `S3Client`(s)/`S3Backend`(s) directly (rather than via
 * `@adobe/helix-shared-storage-s3`'s `createBackendFactory`, which always defers to the
 * ambient AWS credential-provider chain), so tests get deterministic, static fake credentials
 * regardless of the machine's real AWS/SSO configuration — the same reason
 * `@adobe/helix-shared-storage-s3`'s own tests build their clients this way. Always sets
 * `expectContinueHeader: false`, since nock 14 requires it.
 *
 * @param {string} [bucketId] bucket/container name. Defaults to `helix-media-bus`.
 * @param {string} [r2AccountId] Cloudflare account ID used to build the R2 endpoint hostname.
 * @param {boolean} [disableR2] if `true`, no R2 mirror backend is created.
 * @param {Console} [log]
 * @returns {Bucket}
 */
export function buildTestStorageBucket({
  bucketId = 'helix-media-bus',
  r2AccountId = 'fake',
  disableR2 = false,
  log = console,
} = {}) {
  const baseOpts = {
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
    expectContinueHeader: false,
    requestHandler: new NodeHttpHandler(),
  };
  const s3Client = new S3Client(baseOpts);
  const s3Backend = new S3Backend({
    client: s3Client, name: 'S3', bucketName: bucketId, log,
  });
  if (disableR2) {
    return new Bucket({ backend: s3Backend, log });
  }
  const r2Client = new S3Client({
    ...baseOpts,
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    region: 'us-east-1',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  });
  const r2Backend = new S3Backend({
    client: r2Client, name: 'R2', bucketName: bucketId, log,
  });
  return new Bucket({
    backend: new MirroringBackend({ primary: s3Backend, secondaries: [r2Backend], log }),
    log,
  });
}
