import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['**/tests/**'],
    },
  }
});
