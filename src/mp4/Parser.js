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
import { FTYPAtom } from './FTYPAtom.js';
import { MVHDAtom } from './MVHDAtom.js';
import { TKHDAtom } from './TKHDAtom.js';
import { HDLRAtom } from './HDLRAtom.js';

/**
 * Atoms that contain again atoms that we're interested in.
 */
const CONTAINERS = [
  'moov',
  'trak',
  'mdia',
];

/**
 * Atoms that need post processing.
 */
const ATOMS = {
  ftyp: FTYPAtom,
  mvhd: MVHDAtom,
  tkhd: TKHDAtom,
  hdlr: HDLRAtom,
};

/**
 * Map of 'ftyp' to mime-type
 */
const MIME_TYPES = new Map([
  ['3g2b', 'video/3gpp2'],
  ['3g2c', 'video/3gpp2'],
  ['3ge6', 'video/3gpp'],
  ['3ge7', 'video/3gpp'],
  ['3gg6', 'video/3gpp'],
  ['3gp1', 'video/3gpp'],
  ['3gp2', 'video/3gpp'],
  ['3gp3', 'video/3gpp'],
  ['3gp4', 'video/3gpp'],
  ['3gp5', 'video/3gpp'],
  ['3gp6', 'video/3gpp'],
  ['3gp6', 'video/3gpp'],
  ['3gp6', 'video/3gpp'],
  ['3gs7', 'video/3gpp'],
  ['avc1', 'video/mp4'],
  ['dvr1', 'video/vnd.dvb.file'],
  ['dvt1', 'video/vnd.dvb.file'],
  ['F4V ', 'video/mp4'],
  ['F4P ', 'video/mp4'],
  ['iso2', 'video/mp4'],
  ['isom', 'video/mp4'],
  ['KDDI', 'video/3gpp2'],
  ['M4V ', 'video/x-m4v'],
  ['M4VH', 'video/x-m4v'],
  ['M4VP', 'video/x-m4v'],
  ['mj2s', 'video/mj2'],
  ['mjp2', 'video/mj2'],
  ['mmp4', 'video/mp4'],
  ['mp41', 'video/mp4'],
  ['mp42', 'video/mp4'],
  ['mqt ', 'video/quicktime'],
  ['NDSC', 'video/mp4'],
  ['NDSH', 'video/mp4'],
  ['NDSM', 'video/mp4'],
  ['NDSP', 'video/mp4'],
  ['NDSS', 'video/mp4'],
  ['NDXC', 'video/mp4'],
  ['NDXH', 'video/mp4'],
  ['NDXM', 'video/mp4'],
  ['NDXP', 'video/mp4'],
  ['NDXS', 'video/mp4'],
  ['qt  ', 'video/quicktime'],
]);

export class Parser {
  /**
   * Create a new parser
   * @param {Buffer} buf buffer
   * @param {Logger} log logger
   * @param {String} name to log
   */
  constructor(buf, log, name) {
    this.buf = buf;
    this.log = log;
    this.name = name || 'mp4';
  }

  /**
   * Process all atoms in a parent
   * @param {Object} context current parse context
   */
  parseAtoms(context) {
    // const { buf, log } = this;
    const { parent, name, log } = context;
    const { buf, pos } = parent;

    let offset = 0;
    while (offset + 8 < buf.length) {
      let size = buf.readUInt32BE(offset);
      let minsize = 8;

      if (size === 1 && offset + 16 < buf.length) {
        size = Number(buf.readBigUInt64BE(offset + 8));
        minsize = 16;
      } else if (size === 0) {
        size = buf.length - offset;
      }
      if (offset + size > buf.length) {
        throw new Error(`[${name}] ${parent.getPath()} (${pos + offset}): Size points beyond buffer: ${size}`);
      }
      if (size < minsize) {
        offset += minsize;
      } else {
        const type = buf.toString('ascii', offset + 4, offset + 8);
        const atom = new (ATOMS[type] || Atom)(
          parent,
          buf.subarray(offset + minsize, offset + size),
          type,
          offset + pos,
        );
        log.debug(atom.toString());
        atom.parseContent?.(context);

        if (CONTAINERS.includes(type)) {
          this.parseAtoms({ ...context, parent: atom });
        }
        offset += size;
      }
    }
  }

  /**
   * Probes the first 16 bytes to check for MP4 signatures.
   *
   * @returns true if file is potentially an MP4, false otherwise
   */
  probe() {
    const { buf, name, log } = this;

    if (buf.length < 16) {
      log.info(`[${name}] Buffer too small: ${buf.length}`);
      return false;
    }

    const size = buf.readUInt32BE(0);
    if (size > buf.length) {
      log.info(`[${name}] Size points beyond buffer: ${size}`);
      return false;
    }
    const tag = buf.toString('ascii', 4, 8);
    if (tag !== 'ftyp') {
      log.info(`[${name}] Expected tag 'ftyp', got: ${tag}`);
      return false;
    }
    const ftyp = buf.toString('ascii', 8, 12);
    if (!MIME_TYPES.get(ftyp)) {
      log.info(`[${name}] 'ftyp' has unknown value for a video: ${ftyp}`);
      return false;
    }
    return true;
  }

  /**
   * Parse an MP4.
   *
   * @returns duration, width and height if this is an MP4, null otherwise
   */
  parse() {
    const { buf, log, name } = this;

    if (!this.probe()) {
      return null;
    }

    try {
      const parent = new Atom(null, buf, 'root');
      const context = {
        name, parent, movie: {}, tracks: [], log,
      };
      this.parseAtoms(context);

      const { movie, tracks, filetype } = context;
      const result = {
        type: MIME_TYPES.get(filetype),
      };
      if (movie.duration) {
        result.duration = movie.duration;
      }
      const video = tracks.find((track) => track.subtype === 'vide');
      if (video) {
        result.width = video.width;
        result.height = video.height;
      }
      return result;
    } catch (e) {
      log.warn(`Unable to process media: ${e.message}`);
      return null;
    }
  }
}
