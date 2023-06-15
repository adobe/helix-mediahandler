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
import { Atom } from './Atom.js';

/**
 * Movie header atom.
 */
export class MVHDAtom extends Atom {
  parseContent(context) {
    const { buf, pos } = this;
    const { movie, name, log } = context;

    this.assertLength(name, 100);

    const version = buf.readUInt8();
    let timescale = buf.readInt32BE(12);
    if (timescale <= 0) {
      log.warn(`[${name}] ${this.getPath()} (${pos + 12}): invalid time scale ${timescale}, defaulting to 1`);
      timescale = 1;
    }
    const duration = version === 1
      ? Number(buf.readBigUInt64BE(16))
      : buf.readUInt32BE(16);
    movie.duration = Math.round(duration / timescale);
  }
}
