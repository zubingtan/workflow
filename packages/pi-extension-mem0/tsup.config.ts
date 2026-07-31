import { defineConfig } from 'tsup';

export default defineConfig({
  // Single entry emitted as dist/index.js so pi's file discovery
  // (resolveExtensionEntries: package.json "pi.extensions" OR index.js)
  // finds the extension default export under
  // {agentDir}/extensions/pi-extension-mem0/ (spec #212 D2/D15).
  entry: { index: 'src/entry.ts' },
  format: ['esm'],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  external: [/^node:/, /^@earendil-works\//, 'typebox'],
});
