import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * The API the packaged app is allowed to call. Apps Script answers from
 * script.google.com and then redirects to script.googleusercontent.com, so a
 * policy naming only the first would block every request at the redirect.
 */
const API_HOSTS = 'https://script.google.com https://script.googleusercontent.com';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Recharts and the receipt layout set element styles directly.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' " + API_HOSTS,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Adds the policy to built output only.
 *
 * It cannot go in index.html directly: the dev server rewrites the page with
 * inline scripts and needs eval for hot reload, so a policy strict enough to be
 * worth having would break development. Previously this came from helmet on the
 * Node server, which meant the Android and desktop builds — the ones that
 * actually leave this machine — had no policy at all.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'nf-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        '<head>\n    <meta http-equiv="Content-Security-Policy" content="' +
          CONTENT_SECURITY_POLICY +
          '" />',
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load the whole .env (not just VITE_ prefixed vars) so the dev proxy follows
  // API_PORT rather than assuming it.
  const env = loadEnv(mode, process.cwd(), '');

  // The client dev server has no fixed-port requirement — nothing calls back
  // into it — so honour an assigned PORT and fall back to Vite's default.
  // The API listens on API_PORT (see server/env.ts), which is what the proxy
  // targets; the two must not collide.
  const clientPort = Number(process.env.PORT ?? 5173);
  // Deliberately never falls back to PORT: in development PORT is the CLIENT's
  // port, so using it here would make the proxy target itself.
  const apiPort = env.API_PORT || '4000';

  return {
    plugins: [react(), contentSecurityPolicy()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: {
      port: clientPort,
      proxy: {
        '/api': {
          target: 'http://localhost:' + apiPort,
          changeOrigin: true,
          // A sale is three Apps Script round trips and a contended one can
          // queue behind the transaction lock, so the proxy has to wait
          // longer than its default or the browser sees a 504 for a request
          // the server is still happily working on.
          timeout: 120_000,
          proxyTimeout: 120_000,
        },
      },
    },
    build: {
      outDir: 'dist/client',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  };
});
