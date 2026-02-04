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

import { MediaHandler } from './MediaHandler';

export interface TrackedImage {
  uri: string;
  hash: string;
  contentType: string;
  width?: string;
  height?: string;
  originalUri?: string;
  uploaded?: boolean;
}

export interface TrackingMediaHandler {
  handler: MediaHandler;
  getUploadedImages(): TrackedImage[];
}

export function createTrackingMediaHandler(mediaHandler: MediaHandler): TrackingMediaHandler;
