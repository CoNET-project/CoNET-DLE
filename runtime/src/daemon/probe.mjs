#!/usr/bin/env node
const archiveUrl = process.argv.includes('--archive')
  ? process.argv[process.argv.indexOf('--archive') + 1]
  : 'http://127.0.0.1:27101'
if (!archiveUrl) {
  process.stderr.write('usage: probe.mjs --archive http://127.0.0.1:27101\n')
  process.exit(2)
}

const endpoint = archiveUrl.replace(/\/$/, '')
const healthRes = await fetch(`${endpoint}/health`)
if (!healthRes.ok) throw new Error(`archive health HTTP ${healthRes.status}`)
const health = await healthRes.json()
const rpc = async (method, params = []) => {
  const response = await fetch(`${endpoint}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`archive RPC HTTP ${response.status}`)
  return response.json()
}
const info = await rpc('dle_info')
const chainId = await rpc('eth_chainId')
const forbidden = await rpc('eth_call', [])
const ok =
  health.ok === true &&
  health.command === 'archive' &&
  health.runtime === 'nodejs' &&
  health.producesBlocks === false &&
  info.result?.command === 'archive' &&
  typeof chainId.result === 'string' &&
  chainId.result !== '0x36ca6' &&
  Boolean(forbidden.error)

process.stdout.write(
  `${JSON.stringify(
    {
      ok,
      command: 'daemon',
      runtime: typeof document === 'undefined' ? 'nodejs' : 'browser',
      archiveUrl: endpoint,
      health,
      info,
      chainId,
      ethCallRejected: Boolean(forbidden.error),
    },
    null,
    2,
  )}\n`,
)
if (!ok) process.exit(2)
