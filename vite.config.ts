import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl()],
  // Relative asset URLs, so the same build works from a domain root and from
  // the /blackhole-sim/ subpath GitHub Pages serves a project site at.
  base: './',
  build: { target: 'es2022' },
});
