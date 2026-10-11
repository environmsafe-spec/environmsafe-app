import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { csp } from './scripts/csp.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => ({
  preview: {
    // Same security headers as production, so tests run under the real policy.
    headers: {
      'Content-Security-Policy': csp(loadEnv(mode, process.cwd(), '').VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'logo.png'],
      manifest: {
        name: 'EnvironmSafe Records',
        short_name: 'ES Records',
        description: 'Inspection and testing records for EnvironmSafe',
        theme_color: '#1B1B3A',
        background_color: '#1B1B3A',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,ttf}'],
        globIgnores: ['download/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/download\//, /^\/version\.json$/],
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
}));
