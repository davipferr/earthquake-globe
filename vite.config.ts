import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the build works under any sub-path (e.g. GitHub Pages /earthquake-globe/).
  base: './',
  // Three.js alone is ~550 kB minified (150 kB gzipped); one chunk is fine for a single-page app.
  build: { chunkSizeWarningLimit: 800 },
});
