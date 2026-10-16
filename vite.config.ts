import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// Relative base so the same build works at any GitHub Pages path.
export default defineConfig({
  base: './',
  // BUILD_ID changes with every build. Data files are fetched with it in the
  // address, so a new build never shows the last build's items or map places.
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',      // a new build takes over at once; src/lib/update.ts then reloads the page when it is safe
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Black Tusk Companion',
        short_name: 'Black Tusks',
        description: 'Companion for the Black Tusk clan of Largashbur on Daedric Online.',
        display: 'standalone',
        // phones open the installed app upright; Android keeps it there (computers ignore this)
        orientation: 'portrait',
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
        // The game data rides with the app itself: it is fetched whole when a build is installed, so an open
        // app never runs on half a file. Data addresses carry ?v=<build>, which only exists to beat browser caches.
        globPatterns: ['**/*.{js,css,html,woff2}', 'img/*', 'icons/*', 'data/*.json'],
        ignoreURLParametersMatching: [/^v$/, /^utm_/, /^fbclid$/],
        navigateFallback: 'index.html',
        runtimeCaching: [
          { urlPattern: /\/map\/.*\.(webp|json)$/, handler: 'CacheFirst', options: { cacheName: 'map-tiles', expiration: { maxEntries: 1400 } } },
          { urlPattern: /\/data\/.*\.json/, handler: 'CacheFirst', options: { cacheName: 'game-data-v2', expiration: { maxEntries: 6 } } },
          // item pictures carry a stamp of their contents in the address (?v=), so an address never changes its picture
          { urlPattern: /\/items\/.*\.webp(\?|$)/, handler: 'CacheFirst', options: { cacheName: 'item-pictures-v2', expiration: { maxEntries: 500 } } },
          { urlPattern: /\/storage\/v1\/object\/public\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'item-images', expiration: { maxEntries: 600 } } },
        ],
      },
    }),
  ],
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
