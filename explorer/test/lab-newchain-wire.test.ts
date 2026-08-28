import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LAB_CLASS_ASSET,
  LAB_CLASS_STORAGE,
  LAB_NEWCHAIN_REQUEST_SCHEMA,
  chainsOwnedBy,
  classNameOf,
  labChainNftIdFromRequestId,
  makeNewChainRequest,
  newChainRequestId,
  parseLabNewChainList,
} from '../src/lib/labNewchainWire.ts'

describe('labNewchainWire', () => {
  it('builds Mode A request and deterministic requestId', () => {
    const salt = '0x1111111111111111111111111111111111111111111111111111111111111111' as const
    const user = '0xd1e0000000000000000000000000000000000001' as const
    const asset = makeNewChainRequest({
      classId: LAB_CLASS_ASSET,
      nonce: '7',
      salt,
      user,
    })
    assert.equal(asset.schema, LAB_NEWCHAIN_REQUEST_SCHEMA)
    assert.equal(asset.labOnly, true)
    assert.equal(asset.notL1Nft, true)
    assert.equal(asset.classId, 1)
    assert.equal(asset.user, user)
    assert.equal(asset.nonce, '7')
    assert.equal(classNameOf(asset.classId), 'asset')

    const requestId = newChainRequestId(asset)
    assert.match(requestId, /^0x[0-9a-f]{64}$/)
    assert.equal(newChainRequestId(asset), requestId)

    const storage = makeNewChainRequest({
      classId: LAB_CLASS_STORAGE,
      nonce: '7',
      salt,
      user,
    })
    assert.equal(classNameOf(storage.classId), 'storage')
    assert.notEqual(newChainRequestId(storage), requestId)

    const nft = labChainNftIdFromRequestId(requestId)
    assert.match(nft, /^\d+$/)
    assert.notEqual(nft, '42')
  })

  it('parses GET /newchain/chains and filters by owner wallet', () => {
    const owner = '0xAbCdEf0000000000000000000000000000000001'
    const other = '0x00000000000000000000000000000000000000aa'
    const body = {
      schema: 'DleLabNewChainListV1',
      chains: [
        {
          requestId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          chainNftId: '1001',
          classId: 1,
          className: 'asset',
          user: owner,
          acceptedAt: '2026-08-21T10:00:00.000Z',
          archiveCertificatePending: true,
        },
        {
          requestId: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          chainNftId: '1002',
          classId: 2,
          className: 'storage',
          user: other,
          acceptedAt: '2026-08-21T11:00:00.000Z',
          archiveCertificate: { schema: 'x' },
        },
        {
          requestId: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          chainNftId: '1003',
          classId: 2,
          className: 'storage',
          user: owner.toLowerCase(),
          acceptedAt: '2026-08-21T12:00:00.000Z',
        },
        { bad: true },
      ],
    }
    const rows = parseLabNewChainList(body)
    assert.equal(rows.length, 3)
    assert.equal(rows[0]?.chainNftId, '1003')
    const mine = chainsOwnedBy(rows, owner)
    assert.equal(mine.length, 2)
    assert.deepEqual(
      mine.map((r) => r.chainNftId),
      ['1003', '1001'],
    )
    assert.equal(chainsOwnedBy(rows, null).length, 0)
    assert.equal(parseLabNewChainList(null).length, 0)
  })
})
