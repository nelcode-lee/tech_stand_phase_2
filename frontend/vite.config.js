import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Set VITE_BACKEND_PORT=8002 in .env.local to override the default backend port.
// Full agent pipeline + large SOPs can exceed a few minutes; default proxy timeout is 10 minutes.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || '8000'
  const rawTimeout = (env.VITE_DEV_PROXY_TIMEOUT_MS || '').trim()
  const proxyTimeoutMs =
    rawTimeout === '' || rawTimeout === undefined
      ? 600_000
      : Math.min(Math.max(0, parseInt(rawTimeout, 10) || 600_000), 86_400_000)

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          // http-proxy: time to wait for target; streaming /analyse can run many minutes on large docs
          timeout: proxyTimeoutMs,
          proxyTimeout: proxyTimeoutMs,
          configure: (proxy) => {
            proxy.on('proxyReq', (_proxyReq, req) => {
              req.setTimeout(0)
            })
            proxy.on('proxyRes', (_proxyRes, req, res) => {
              req.setTimeout(0)
              res.setTimeout(0)
            })
          },
        },
      },
    },
  }
})
