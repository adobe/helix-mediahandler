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
/* eslint-disable no-param-reassign */
const md2hast = require('mdast-util-to-hast');
const hast2html = require('hast-util-to-html');

function robustTables() {
  const { Compiler: { prototype: { visitors } } } = this;

  function tableCell(node) {
    const { children = [] } = node;
    // if the table cell has children and if they are other than just 1 paragraph...
    if (children.length > 1 || (children.length === 1 && children[0].type !== 'paragraph')) {
      // ...then convert the problematic children to html nodes
      node.children.forEach((child) => {
        switch (child.type) {
          case 'code': {
            // code needs special treatment, otherwise the newlines disappear.
            const html = hast2html(md2hast(child));
            child.type = 'html';
            child.value = html.replace(/\r?\n/g, '<br>');
            break;
          }
          default: {
            // convert the rest to html
            child.value = hast2html(md2hast(child));
            child.type = 'html';
          }
        }
      });
    }
    return this.all(node).join('').replace(/\r?\n/g, ' ');
  }
  visitors.tableCell = tableCell;
}

module.exports = robustTables;
