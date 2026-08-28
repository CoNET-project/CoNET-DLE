import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeWalletChoices, type InjectedWalletChoice } from '../src/lib/injectedWallets.ts'

const fake = (label: string): InjectedWalletChoice['provider'] => ({
  request: async () => [],
})

describe('mergeWalletChoices', () => {
  it('dedupes brands and prefers EIP-6963 icon/rdns', () => {
    const merged = mergeWalletChoices([
      { id: 'metamask', label: 'MetaMask', provider: fake('a') },
      {
        id: 'metamask',
        label: 'MetaMask',
        provider: fake('b'),
        iconUrl: 'data:image/png;base64,aa',
        rdns: 'io.metamask',
      },
      { id: 'other', label: 'Rabby Wallet', provider: fake('c'), rdns: 'io.rabby' },
      { id: 'other', label: 'Brave Wallet', provider: fake('d'), rdns: 'com.brave.wallet' },
    ])
    assert.equal(merged.length, 3)
    assert.equal(merged[0]?.id, 'metamask')
    assert.equal(merged[0]?.rdns, 'io.metamask')
    assert.ok(merged[0]?.iconUrl)
    assert.equal(merged.filter((w) => w.id === 'other').length, 2)
  })
})
