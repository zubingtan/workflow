/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pluginReact } from '@rsbuild/plugin-react';
import { pluginLess } from '@rsbuild/plugin-less';
import { defineConfig } from '@rsbuild/core';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  plugins: [pluginReact(), pluginLess()],
  source: {
    entry: {
      index: './src/app.tsx',
    },
    /**
     * support inversify @injectable() and @inject decorators
     */
    decorators: {
      version: 'legacy',
    },
    alias: {
      // D6 pitfall 1: @douyinfe/semi-ui 2.101.1's `exports` field doesn't
      // expose `./dist/css/semi.min.css`, but the prebuilt CSS file physically
      // exists at that path. Mapping the bare specifier to the absolute file
      // path bypasses the exports-field check. Remove if Semi later adds the
      // export (or switch to per-component CSS imports).
      '@douyinfe/semi-ui/dist/css/semi.min.css': resolve(
        __dirname,
        'node_modules/@douyinfe/semi-ui/dist/css/semi.min.css'
      ),
    },
  },
  html: {
    title: 'Workflow',
    tags: [
      // FOUC prevention — inline synchronous script in <body> BEFORE the React
      // mount point (#root). Runs before the bundle loads so the first paint
      // is already in the correct theme. Priority:
      //   localStorage['workflow-theme'] > prefers-color-scheme > light
      // Mirrors src/theme/fouc.mjs::applyInitialTheme — kept inline (not
      // imported) because it must execute before the bundle loads.
      // `head: false` places it in <body>; `append: false` places it before
      // the existing `<div id="root">` tag. Property names follow rsbuild's
      // HtmlTag schema: `attrs` (not `attributes`), `children` (not `innerHTML`).
      {
        tag: 'script',
        head: false,
        append: false,
        attrs: { type: 'text/javascript' },
        children: `(function(){var s=null;try{s=localStorage.getItem('workflow-theme')}catch(e){s=null}var r;if(s==='light'||s==='dark'){r=s}else{var p=false;try{p=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(e){p=false}r=p?'dark':'light'}document.body.setAttribute('theme-mode',r)})();`,
      },
    ],
  },
  tools: {
    rspack: {
      /**
       * ignore warnings from @coze-editor/editor/language-typescript
       */
      ignoreWarnings: [/Critical dependency: the request of a dependency is an expression/],
    },
  },
});
