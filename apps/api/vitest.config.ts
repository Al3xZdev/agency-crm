import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Vitest pipeline for the API. SWC is required because Nest's DI relies on
 * `emitDecoratorMetadata`, which esbuild (vitest's default transform) does
 * not emit. Build (`tsc`) is untouched — this only affects test runs.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // Nest decorators require the Reflect metadata polyfill BEFORE any module
    // using them is evaluated.
    setupFiles: ['./test/setup.ts'],
  },
  // Reads apps/api/.swcrc (legacyDecorator + decoratorMetadata) — required
  // for Nest DI at test time.
  plugins: [swc.vite()],
});
