#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DLE_COMMAND, DLE_RUNTIME } from '../shared/protocol.js'

function parseArgs(argv: string[]): { port: number } {
  let port = 27111
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--port' && next !== undefined) {
      port = Number(next)
      i += 1
    }
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('invalid --port')
  return { port }
}

const options = parseArgs(process.argv.slice(2))
const htmlPath = join(dirname(fileURLToPath(import.meta.url)), 'public/index.html')
const html = readFileSync(htmlPath, 'utf8')

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${options.port}`)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

await new Promise<void>((resolve, reject) => {
  server.listen(options.port, '127.0.0.1', () => resolve())
  server.on('error', reject)
})

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      command: DLE_COMMAND.daemon,
      pageRuntime: DLE_RUNTIME.browser,
      serveRuntime: DLE_RUNTIME.nodejs,
      url: `http://127.0.0.1:${options.port}/`,
      note: 'Open this URL in a browser. The daemon logic runs in the page; this process only serves HTML.',
    },
    null,
    2,
  )}\n`,
)
