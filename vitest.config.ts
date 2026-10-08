import { defineConfig } from 'vitest/config';

// Unit tests target framework-free modules in src/. DOM tests opt into happy-dom per file.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
