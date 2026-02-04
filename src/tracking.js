/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Creates a wrapper around MediaHandler that tracks all uploaded blobs.
 *
 * @param {import('./MediaHandler.js').default} mediaHandler - The original media handler
 * @returns {{ handler: object, getUploadedImages: () => Array }} Tracking wrapper and accessor
 */
export function createTrackingMediaHandler(mediaHandler) {
  const uploadedImages = [];

  const wrappedHandler = {
    ...mediaHandler,
    async getBlob(url, sourceUri) {
      const blob = await mediaHandler.getBlob(url, sourceUri);
      if (blob && blob.uri) {
        uploadedImages.push({
          uri: blob.uri,
          hash: blob.hash,
          contentType: blob.contentType,
          width: blob.meta?.width,
          height: blob.meta?.height,
          originalUri: url,
          uploaded: blob.uploaded, // true = newly uploaded, false = reused from storage
        });
      }
      return blob;
    },
    // Preserve the fetchContext for cleanup
    get fetchContext() {
      return mediaHandler.fetchContext;
    },
  };

  return {
    handler: wrappedHandler,
    getUploadedImages: () => uploadedImages,
  };
}
