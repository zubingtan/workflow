import { defineConfig } from 'tsup';

export default defineConfig([
  // Library entry (client + types for programmatic use)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  // Extension entry (bundled for pi-agent discovery in extensions/ dir)
  {
    entry: { extension: 'src/extension.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: true,
    noExternal: [/^(?!\@earendil-works|typebox)/],
    external: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', 'typebox'],
  },
]);
