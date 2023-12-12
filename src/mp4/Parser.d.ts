/*
 * Copyright 2021 Adobe. All rights reserved.
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
 * Default Resource Meta
 */
export declare interface MP4Info {
  /**
   * Width
   */
  width: number;

  /**
   * Height
   */
  height: number;

  /**
   * Duration in seconds
   */
  duration?: number;
}

/**
 * MP4 parser that will return information about width, height and duration.
 */
export declare class MP4Parser {
  /**
   * Creates a new MP4 parser
   *
   * @param {Buffer} buf buffer
   * @param {any} log logger
   * @param {name} name of MP4 being parsed
   * @throws Error If the options are invalid.
   */
  constructor(buf: Buffer, log: any, name?: string);

  /**
   * Probe the buffer whether it is a valid MP4
   *
   * @returns true if the MP4 is valid, false otherwise
   */
  probe(): boolean;

  /**
   * Parse the buffer and return information
   */
  parse(): MP4Info;
}
