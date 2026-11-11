import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

const CONTROLLER = 'http://127.0.0.1:8080';

/**
 * The controller enforces same-origin mutations against NB_PUBLIC_URL. In dev
 * the browser talks to the Vite origin instead, so proxied requests present
 * the controller's own origin and pass that check. Production serves the app
 * from the controller and never uses this proxy.
 */
function controllerProxy(): ProxyOptions {
  return {
    target: CONTROLLER,
    changeOrigin: false,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('origin', CONTROLLER);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/rpc': controllerProxy(),
      '/api': controllerProxy(),
      '/auth': controllerProxy(),
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/healthz': { target: CONTROLLER },
      '/version': { target: CONTROLLER },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
