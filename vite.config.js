import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` -> PWA en dist/ ; `npm run build:single` -> un único HTML (vista previa)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: { __SINGLE__: JSON.stringify(mode === 'single') },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { environmentOptions: { happyDOM: { settings: { disableJavaScriptFileLoading: true, disableJavaScriptEvaluation: true, disableCSSFileLoading: true } } } },
}));
