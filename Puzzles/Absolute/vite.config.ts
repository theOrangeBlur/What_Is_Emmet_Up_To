import { defineConfig } from 'vitest/config';

// The website serves the build from Puzzles/Thermometers/play/, so asset paths are relative.
// thermometers.html is the public Daily / Free Play page; lab.html is the designer's lab.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        thermometers: 'thermometers.html',
        lab: 'lab.html',
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
