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
const netVersion = await rpc('net_version')
const tipBlock = await rpc('eth_getBlockByNumber', ['latest', false])
const forbidden = await rpc('eth_call', [])
const balance = await rpc('eth_getBalance', ['0x0000000000000000000000000000000000000000', 'latest'])
const batchRes = await fetch(`${endpoint}/rpc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify([
    { jsonrpc: '2.0', id: 10, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 11, method: 'eth_getBalance', params: ['0x0000000000000000000000000000000000000000', 'latest'] },
  ]),
})
if (!batchRes.ok) throw new Error(`archive batch HTTP ${batchRes.status}`)
const batch = await batchRes.json()
const infoResult = info.result ?? {}
const tip = tipBlock.result ?? {}
const ok =
  health.ok === true &&
  health.command === 'archive' &&
  health.runtime === 'nodejs' &&
  health.producesBlocks === false &&
  health.l1Isolated === true &&
  infoResult.command === 'archive' &&
  infoResult.l1Isolated === true &&
  infoResult.batchSupported === true &&
  infoResult.l1ChainIdForbidden === 224422 &&
  typeof chainId.result === 'string' &&
  chainId.result !== '0x36ca6' &&
  netVersion.result === '281669' &&
  (tip.number === '0x0' || tip.number === '0x1') &&
  tip.dleFacade === true &&
  Boolean(forbidden.error) &&
  Boolean(balance.error) &&
  Array.isArray(batch) &&
  batch.length === 2 &&
  batch[0]?.result === chainId.result &&
  Boolean(batch[1]?.error)

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
      netVersion,
      tipBlock,
      ethCallRejected: Boolean(forbidden.error),
      ethGetBalanceRejected: Boolean(balance.error),
      batchOk: Array.isArray(batch) && batch.length === 2,
    },
    null,
    2,
  )}\n`,
)
if (!ok) process.exit(2)
