import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
  optimizeDeps: { exclude: ['@rhwp/core'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icon.svg'],
      manifest: {
        name: '클린오피스',
        short_name: '클린오피스',
        description: '광고 없는 문서 뷰어·편집기',
        lang: 'ko',
        start_url: './',
        display: 'standalone',
        background_color: '#f6f4ee',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        file_handlers: [{
          action: './',
          accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
          },
        }],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globIgnores: ['hwp-studio/**'], // 한글 편집기는 필요할 때만 불러옴
      },
    }),
  ],
});
