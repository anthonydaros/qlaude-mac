import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/main.ts',
    'src/bin/session-hook.ts',
    'src/bin/setup-hooks.ts',
    'src/bin/remove-hooks.ts',
  ],
  format: ['esm'],
  target: 'node20',
  clean: true,
  shims: true,
});
