import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// No `npm run dev`, atende /api/* com as mesmas funções que rodam na Vercel.
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/planner', async (req, res) => {
        try {
          const { default: handler } = await server.ssrLoadModule('/api/planner.js')
          const chunks = []
          for await (const c of req) chunks.push(c)
          const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]))
          const request = new Request(`http://localhost${req.originalUrl}`, {
            method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined,
          })
          const response = await handler.fetch(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          server.ssrFixStacktrace(e)
          console.error(e)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Variáveis do .env (inclusive as sem VITE_, como GEMINI_API_KEY) só para o servidor local;
  // o navegador continua recebendo apenas as VITE_.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) process.env[k] ??= v
  return { plugins: [react(), localApi()] }
})
