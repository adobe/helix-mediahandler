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
import { SizeTooLargeException } from './SizeTooLargeException.js';

/**
 * Creates a MediaFilter that checks if the resource is below the indicated size limit.
 * By default, the filter throws a SizeTooLargeException if the resource is too large, unless
 * the `ignored` flag is `true`, in this case it returns `false`.
 * @param {number} maxSize
 * @param {boolean} [ignored = false]
 * @return {MediaFilter}
 */
export function maxSizeMediaFilter(maxSize, ignored = false) {
  return (blob) => {
    if (blob.contentLength > maxSize) {
      const msg = `Resource size exceeds allowed limit: ${blob.contentLength} > ${maxSize}`;
      if (ignored) {
        this.log.warn(msg);
        return false;
      }
      throw new SizeTooLargeException(msg, blob.contentLength, maxSize);
    }
    return true;
  };
}

/**
 * Helper filter that evaluates several filters in sequence.
 * @param {MediaFilter[]} filters
 * @return {MediaFilter}
 */
export function chainedMediaFilter(...filters) {
  return async (blob) => {
    for (const filter of filters) {
      // eslint-disable-next-line no-await-in-loop
      if (!await filter.call(this, [blob])) {
        return false;
      }
    }
    return true;
  };
}

/**
 * Creates a MediaFilter that checks if the blob's contentType starts with the given prefix.
 * @param {string} prefix
 * @return {MediaFilter}
 */
export function contentTypeMediaFilter(prefix) {
  return (blob) => typeof blob.contentType === 'string' && blob.contentType.startsWith(prefix);
}
