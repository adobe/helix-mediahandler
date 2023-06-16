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
 * Handler reference atom.
 */
export class HDLRAtom extends Atom {
  parseContent(context) {
    const { buf, pos } = this;
    const { tracks, name } = context;

    this.assertLength(name, 24);
    if (tracks.length === 0) {
      throw new Error(`[${name}] ${this.getPath()} (${pos}): no tracks added by 'tkhd'`);
    }
    const track = tracks[tracks.length - 1];
    track.subtype = buf.toString('ascii', 8, 12);
  }
}
