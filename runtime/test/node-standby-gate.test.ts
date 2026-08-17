import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { startArchiveNode } from '../src/archive/node.js'
import { setInventoryCatalogFrozen } from '../src/archive/inventoryFreeze.js'
import {
  ERR_NEWCHAIN_STANDBY_NOT_READY,
  makeArchiveStandbyReadiness,
  type SyncInventoryV1,
} from '../src/archive/syncQualification/index.js'
import { keccak256Utf8, type Hex } from '../src/shared/bytes.js'
import { LAB_CLASS_ASSET, makeNewChainRequest } from '../src/shared/newchain.js'

const dirs: string[] = []

after(async () => {
  setInventoryCatalogFrozen(false)
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function postJson(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

function readyFrom(domainId: string, inventory: SyncInventoryV1) {
  return makeArchiveStandbyReadiness({
    domainId,
    groupId: inventory.groupId,
    hostedChainSetRoot: inventory.hostedChainSetRoot as Hex,
    lastACRef: inventory.lastACRef as Hex,
    membershipRoot: inventory.membershipRoot as Hex,
    hashIndexRoot: inventory.hashIndexRoot as Hex,
    ready: true,
  })
}

test('node.ts new-chain accept waits for two official standbys; extra fd-08 does not count', async () => {
  setInventoryCatalogFrozen(false)
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-node-p24-'))
  dirs.push(dataDir)
  const archive = await startArchiveNode({ port: 0, dataDir })
  const base = `http://127.0.0.1:${archive.port}`
  try {
    const request = makeNewChainRequest({
      classId: LAB_CLASS_ASSET,
      nonce: 24,
      salt: keccak256Utf8('dle.test.node.p24.standby.gate'),
    })
    const blocked = await postJson(`${base}/newchain/request`, request)
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.error, ERR_NEWCHAIN_STANDBY_NOT_READY)

    const healthBlocked = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
    assert.equal(healthBlocked.newchainOfficialStandbysReady, false)
    assert.equal(healthBlocked.newchainStandbyReadyEip712, true)
    const syncBlocked = healthBlocked.syncQualification as Record<string, unknown>
    assert.equal(syncBlocked.officialStandbysReady, false)
    assert.equal(syncBlocked.officialStandbyReadyCount, 0)
    assert.equal(syncBlocked.extraStandbyReadyDoesNotCount, true)
    assert.equal(healthBlocked.seatingQualified, false)

    const inventory = (await (await fetch(`${base}/sync/inventory`)).json()) as SyncInventoryV1
    assert.equal(inventory.schema, 'DleLabSyncInventoryV1')
    const status = (await (await fetch(`${base}/sync/status`)).json()) as Record<string, unknown>
    assert.equal(status.hashIndexRoot, inventory.hashIndexRoot)

    const firstOfficial = await postJson(`${base}/sync/standby-ready`, readyFrom('fd-06', inventory))
    assert.equal(firstOfficial.status, 200)
    assert.equal(firstOfficial.body.ok, true)
    const extra = await postJson(`${base}/sync/standby-ready`, readyFrom('fd-08', inventory))
    assert.equal(extra.status, 200)
    assert.equal(extra.body.ok, true)
    const stillBlocked = await postJson(`${base}/newchain/request`, request)
    assert.equal(stillBlocked.status, 409)
    assert.equal(stillBlocked.body.error, ERR_NEWCHAIN_STANDBY_NOT_READY)
    const healthOne = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
    const syncOne = healthOne.syncQualification as Record<string, unknown>
    assert.equal(syncOne.officialStandbyReadyCount, 1)
    assert.equal(syncOne.officialStandbysReady, false)
    assert.equal(healthOne.newchainOfficialStandbysReady, false)

    const secondOfficial = await postJson(`${base}/sync/standby-ready`, readyFrom('fd-07', inventory))
    assert.equal(secondOfficial.status, 200)
    assert.equal(secondOfficial.body.ok, true)
    const healthReady = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
    const syncReady = healthReady.syncQualification as Record<string, unknown>
    assert.equal(syncReady.officialStandbyReadyCount, 2)
    assert.equal(syncReady.officialStandbysReady, true)
    assert.equal(healthReady.newchainOfficialStandbysReady, true)
    assert.equal(healthReady.seatingQualified, false)
    const accepted = await postJson(`${base}/newchain/request`, request)
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.ok, true)
    const healthAfter = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>
    assert.equal(healthAfter.seatingQualified, false)

    const duplicate = await postJson(`${base}/newchain/request`, request)
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.body.duplicate, true)
  } finally {
    await archive.close()
  }
})
