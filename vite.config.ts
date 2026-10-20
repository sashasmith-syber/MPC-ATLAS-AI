import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            // Split heavy deps into cacheable chunks (fixes the 500kB warning)
            manualChunks: {
              react: ['react', 'react-dom/client'],
              genai: ['@google/genai'],
            },
          },
        },
      },
      define: {
        // NOTE (hardening): these are baked into the client bundle — dev convenience only.
        // Production should serve keys at runtime via window.__ATLAS_KEYS__ (see README).
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY_2': JSON.stringify(env.GEMINI_API_KEY_2),
        'process.env.GEMINI_API_KEY_3': JSON.stringify(env.GEMINI_API_KEY_3),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
