// Unit tests for the page helpers in src/lib. Kept apart from vite.config.ts so they run without
// SvelteKit, and from tests/, which holds the Playwright specs.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
