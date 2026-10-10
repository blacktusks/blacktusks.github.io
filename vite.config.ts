import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// Relative base so the same build works at any GitHub Pages path.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Black Tusk Companion',
        short_name: 'Black Tusks',
        description: 'Companion for the Black Tusk clan of Largashbur on Daedric Online.',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}', 'img/*', 'icons/*'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          { urlPattern: /\/map\/.*\.(webp|json)$/, handler: 'CacheFirst', options: { cacheName: 'map-tiles', expiration: { maxEntries: 1400 } } },
          { urlPattern: /\/data\/.*\.json$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'game-data' } },
          { urlPattern: /\/storage\/v1\/object\/public\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'item-images', expiration: { maxEntries: 600 } } },
        ],
      },
    }),
  ],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
