/*
 * Copyright 2026 Adobe. All rights reserved.
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
import assert from 'assert';
import {
  chainedMediaFilter,
  contentTypeMediaFilter,
  maxSizeMediaFilter,
  SizeTooLargeException,
} from '../src/index.js';

describe('Media Filter', () => {
  it('max size filter allows small size', async () => {
    const filter = maxSizeMediaFilter(100);
    const blob = { contentLength: 50 };
    assert.strictEqual(filter(blob), true);
  });

  it('max size filter ignores large size', async () => {
    const filter = maxSizeMediaFilter(100, true);
    const blob = { contentLength: 200 };
    assert.strictEqual(filter(blob), false);
  });

  it('max size filter rejects large size', async () => {
    const filter = maxSizeMediaFilter(100);
    const blob = { contentLength: 200 };
    assert.throws(() => {
      filter(blob);
    }, new SizeTooLargeException('Resource size exceeds allowed limit: 200 > 100', 200, 100));
  });

  it('content type filter allows image', async () => {
    const filter = contentTypeMediaFilter('image/');
    const blob = { contentType: 'image/png' };
    assert.strictEqual(filter(blob), true);
  });

  it('content type filter rejects non image', async () => {
    const filter = contentTypeMediaFilter('image/');
    const blob = { contentType: 'text/plain' };
    assert.strictEqual(filter(blob), false);
  });

  it('content type filter rejects missing content type', async () => {
    const filter = contentTypeMediaFilter('image/');
    const blob = { };
    assert.strictEqual(filter(blob), false);
  });

  it('chained media filter allows small image', async () => {
    const filter = chainedMediaFilter(
      contentTypeMediaFilter('image/'),
      maxSizeMediaFilter(100),
    );
    const blob = { contentType: 'image/png', contentLength: 50 };
    assert.strictEqual(await filter(blob), true);
  });

  it('chained media filter ignores large text', async () => {
    const filter = chainedMediaFilter(
      contentTypeMediaFilter('image/'),
      maxSizeMediaFilter(100),
    );
    const blob = { contentType: 'text/plain', contentLength: 200 };
    assert.strictEqual(await filter(blob), false);
  });

  it('chained media filter rejects large image', async () => {
    const filter = chainedMediaFilter(
      contentTypeMediaFilter('image/'),
      maxSizeMediaFilter(100),
    );
    const blob = { contentType: 'image/png', contentLength: 200 };
    await assert.rejects(filter(blob), new SizeTooLargeException('Resource size exceeds allowed limit: 200 > 100', 200, 100));
  });
});
