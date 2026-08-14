#!/usr/bin/env node
import process from 'node:process'
import { probeArchive } from './core.js'

function parseArgs(argv: string[]): { archiveUrl: string; wait: boolean } {
  let archiveUrl = 'http://127.0.0.1:27101'
  let wait = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--archive' && next !== undefined) {
      archiveUrl = next
      i += 1
      continue
    }
    if (arg === '--wait') {
      wait = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'Usage: dle-daemon --archive http://127.0.0.1:27101 [--wait]\n' +
          'Lightweight daemon. Core is isomorphic and can also run in a browser.\n',
      )
      process.exit(0)
    }
  }
  return { archiveUrl, wait }
}

const options = parseArgs(process.argv.slice(2))
const probed = await probeArchive(options.archiveUrl)
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      ...probed.daemon,
      health: probed.health,
      info: probed.info,
      ...(options.wait ? { wait: probed.wait } : {}),
    },
    null,
    2,
  )}\n`,
)
