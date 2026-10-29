import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
