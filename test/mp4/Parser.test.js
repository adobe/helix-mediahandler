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

/* eslint-env mocha */

import assert from 'assert';
import { Parser } from '../../src/mp4/Parser.js';

describe('MP4 Parser', () => {
  it('Probe a file that is too small', async () => {
    const buf = Buffer.from([0x62, 0x75, 0x66]);
    assert.strictEqual(new Parser(buf, console).probe(), false);
  });

  it('Probe a file that has a bad size', async () => {
    const buf = Buffer.from([
      0x10, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(new Parser(buf, console).probe(), false);
  });

  it('Probe a file that does not start with an FTYP atom', async () => {
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x10, 0x61, 0x62, 0x63, 0x64,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(new Parser(buf, console).probe(), false);
  });

  it('Parse a file that contains an image', async () => {
    const buf = Buffer.from([
      0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70,
      0x6a, 0x70, 0x32, 0x20, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(new Parser(buf, console).parse(), null);
  });

  const FTYP = Buffer.from([
    0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70,
    0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x00, 0x00,
  ]);

  it('Parse a file that contains a long atom size', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x01, 0x61, 0x62, 0x63, 0x64,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x65,
      ]),
    ]);
    assert.notStrictEqual(new Parser(buf, console).parse(), null);
  });

  it('Parse a file that contains a zero atom size', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x00, 0x61, 0x62, 0x63, 0x64,
        0x65,
      ]),
    ]);
    assert.notStrictEqual(new Parser(buf, console).parse(), null);
  });

  it('Parse a file that contains an atom with a size exceeding the buffer limit', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x10, 0x00, 0x00, 0x00, 0x61, 0x62, 0x63, 0x64,
        0x65,
      ]),
    ]);
    assert.strictEqual(new Parser(buf, console).parse(), null);
  });

  it('Parse a file that contains an HDLR atom that is too short', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x0c, 0x68, 0x64, 0x6c, 0x72,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    ]);
    assert.strictEqual(new Parser(buf, console).parse(), null);
  });

  it('Parse a file that contains an HDLR atom without preceding TKHD', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x68, 0x64, 0x6c, 0x72,
      ]),
      Buffer.alloc(32),
    ]);
    assert.strictEqual(new Parser(buf, console).parse(), null);
  });

  it('Parse a file that contains an MVHD atom with an invalid time scale', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x6c, 0x6d, 0x76, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x03, 0xe8,
      ]),
      Buffer.alloc(80),
    ]);
    const info = new Parser(buf, console).parse();
    assert.strictEqual(info.duration, 1000 / 1);
  });

  it('Parse a file that contains an MVHD atom with version 1', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x6c, 0x6d, 0x76, 0x68, 0x64,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xea, 0x60,
      ]),
      Buffer.alloc(80),
    ]);
    const info = new Parser(buf, console).parse();
    assert.strictEqual(info.duration, 60000 / 1000);
  });

  const HDLR = Buffer.from([
    0x00, 0x00, 0x00, 0x20, 0x68, 0x64, 0x6c, 0x72,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x76, 0x69, 0x64, 0x65, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  it('Parse a file that contains a TKHD atom with version 1', async () => {
    const buf = Buffer.concat([
      FTYP,
      Buffer.from([
        0x00, 0x00, 0x00, 0x68, 0x74, 0x6b, 0x68, 0x64,
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
      Buffer.alloc(80),
      Buffer.from([
        0x02, 0x80, 0x00, 0x00, 0x01, 0xe0, 0x00, 0x00,
      ]),
      HDLR,
    ]);
    const info = new Parser(buf, console).parse();
    assert.deepStrictEqual(info, {
      type: 'video/quicktime', width: 640, height: 480,
    });
  });
});
