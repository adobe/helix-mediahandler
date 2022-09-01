/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import yauzl from 'yauzl';
import promises from '@adobe/mammoth/lib/promises.js';
import { joinPath, splitPath } from '@adobe/mammoth/lib/zipfile.js';

/**
 * copied from @adobe/docx2md for testing image upload
 */

export function openArrayBuffer(arrayBuffer) {
  const { resolve, reject, promise } = promises.defer();
  yauzl.fromBuffer(arrayBuffer, { lazyEntries: false }, (err, zipFile) => {
    if (err) {
      reject(err);
      return;
    }
    const entries = new Map();

    // add entries to internal dictionary
    zipFile.on('entry', async (entry) => {
      entries.set(entry.fileName, entry);
    });

    function exists(name) {
      return entries.has(name);
    }

    function read(name, encoding, asContentSource) {
      const entry = entries.get(name);
      if (!entry) {
        return promises.reject(Error(`No such file ${name}`));
      }

      const { resolve: resolve2, reject: reject2, promise: promise2 } = promises.defer();
      const buffers = [];

      zipFile.openReadStream(entry, (error, readStream) => {
        if (error) {
          reject2(error);
          return;
        }
        if (asContentSource) {
          resolve2({
            stream: readStream,
            size: entry.uncompressedSize,
          });
          return;
        }
        readStream.on('data', (chunk) => {
          buffers.push(chunk);
        });
        readStream.on('end', () => {
          const data = Buffer.concat(buffers);
          if (encoding) {
            resolve2(data.toString(encoding));
          } else {
            resolve2(data);
          }
        });
      });
      return promise2;
    }

    function write() {
      throw Error('no supported');
    }

    function toBuffer() {
      throw Error('no supported');
    }

    // once all entries arrived, resolve the promise with the API
    zipFile.on('end', () => {
      resolve({
        exists,
        read,
        write,
        toBuffer,
      });
    });
  });
  return promise;
}

export default {
  openArrayBuffer,
  splitPath,
  joinPath,
};
