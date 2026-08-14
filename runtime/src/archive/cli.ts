#!/usr/bin/env node
import { resolve } from 'node:path'
import { startArchiveNode } from './node.js'

function parseArgs(argv: string[]): { port: number; dataDir: string } {
  let port = 27101
  let dataDir = resolve('data/dle-archive')
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--port' && next !== undefined) {
      port = Number(next)
      i += 1
      continue
    }
    if (arg === '--data-dir' && next !== undefined) {
      dataDir = resolve(next)
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: dle-archive --port 27101 --data-dir ./data/dle-archive\n' +
          'Node.js-only archive node. Does not produce blocks.\n',
      )
      process.exit(0)
    }
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid --port')
  return { port, dataDir }
}

const options = parseArgs(process.argv.slice(2))
const server = await startArchiveNode(options)
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      ...server.info,
      dataDir: options.dataDir,
    },
    null,
    2,
  )}\n`,
)

const shutdown = (): void => {
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
