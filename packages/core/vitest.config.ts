import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Allow sources/tests to use canonical ".js" import specifiers for ".ts" files. */
const tsExtension = {
  name: 'ts-js-specifiers',
  resolveId(source: string, importer?: string) {
    if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
    const base = new URL(source, pathToFileURL(importer));
    const tsPath = fileURLToPath(base).replace(/\.js$/, '.ts');
    return existsSync(tsPath) ? tsPath : null;
  },
};

export default defineConfig({
  plugins: [tsExtension],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
