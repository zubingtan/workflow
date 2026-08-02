import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pluginReact } from '@rsbuild/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from '@rsbuild/core';

const rootDir = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/prototypes/shadcn-ui/index.tsx',
    },
  },
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  html: {
    title: 'Workflow UI Directions',
  },
  server: {
    port: 4173,
  },
  tools: {
    postcss: (_config, { addPlugins }) => {
      addPlugins(tailwindcss());
    },
  },
});
