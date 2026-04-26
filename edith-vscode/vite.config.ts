import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'webview',
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'webview/index.html'),
      output: {
        entryFileNames: 'webview.js',
        chunkFileNames: 'webview.[name].js',
        assetFileNames: 'webview.[ext]'
      }
    },
    sourcemap: true,
    target: 'es2022'
  }
});
