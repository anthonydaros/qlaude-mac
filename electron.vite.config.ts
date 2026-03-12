import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// electron-vite's TypeScript types don't expose lib/rollupOptions.input
// in BuildEnvironmentOptions, but they work at runtime per the docs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuild = any;

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      lib: { entry: resolve('src/electron/main.ts') },
    } as AnyBuild,
  },
  preload: {
    build: {
      externalizeDeps: true,
      lib: { entry: resolve('src/electron/preload.ts') },
    } as AnyBuild,
  },
  renderer: {
    root: resolve('src/electron/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/electron/renderer/index.html'),
      },
    } as AnyBuild,
    plugins: [react()],
  },
});
