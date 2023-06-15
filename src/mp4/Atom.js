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

/**
 * Generic Atom
 */
export class Atom {
  constructor(parent, buf, type, pos) {
    this.parent = parent;
    this.buf = buf;
    this.type = type;
    this.pos = pos || 0;
    this.children = [];

    parent?.children.push(this);
  }

  /**
   * Assert that an atom has at least that length.
   *
   * @param {String} name name
   * @param {Number} num number of bytes expected
   */
  assertLength(name, num) {
    const { buf, pos } = this;
    if (buf.length < num) {
      throw new Error(`[${name}] ${this.getPath()} (${pos}): atom should contain at least ${num} bytes, found: ${buf.length}`);
    }
  }

  getPath() {
    const { parent, type } = this;
    return `${parent?.getPath() || ''}/${type}`;
  }

  toString() {
    const { buf, type, pos } = this;
    return `${type}: [${pos}-${pos + buf.length}]`;
  }
}
