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

/* eslint-disable no-bitwise */

import { Atom } from './Atom.js';

/**
 * Track header atom.
 */
export class TKHDAtom extends Atom {
  parseContent(context) {
    const { buf } = this;
    const { tracks, name } = context;

    this.assertLength(name, 84);

    const version = buf.readUInt8();
    let offset = (version === 1 ? 20 : 12);
    const id = buf.readUInt32BE(offset);

    offset = (version === 1 ? 88 : 76);
    this.assertLength(name, offset + 8);
    const width = buf.readUInt32BE(offset) >> 16;
    const height = buf.readUInt32BE(offset + 4) >> 16;

    const track = { id, width, height };
    tracks.push(track);
  }
}
