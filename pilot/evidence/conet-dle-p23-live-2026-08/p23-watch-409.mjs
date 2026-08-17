#!/usr/bin/env node
/**
 * P23 lab watcher: wait for new binary on fd-01, POST /newchain/request
 * while officialStandbysReady === false (expect 409), then again when true (expect 200).
 * Lab-only. Does not start the 30-day clock.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FD01 = 'http://45.132.74.220:27101'
const OUT_DIR = resolve(import.meta.dirname)
const REQUEST = {
  schema: 'DleLabNewChainRequestV1',
  labOnly: true,
  notProductionDepin: true,
  notL1Nft: true,
  classId: 1,
  user: '0xd1e0000000000000000000000000000000000001',
  nonce: String(Date.now()),
  salt: '0x' + 'p23keepdeploy409accept20260817'.padEnd(64, '0').replace(/[^0-9a-f]/gi, 'a').slice(0, 64),
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function getJson(url, timeoutMs = 8000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    const text = await res.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(t)
  }
}

async function postJson(url, body, timeoutMs = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await res.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }
    return { status: res.status, body: parsed }
  } finally {
    clearTimeout(t)
  }
}

function overlay(health) {
  const sq = health?.syncQualification ?? {}
  return {
    domainId: health?.domainId,
    role: health?.role,
    command: health?.command,
    seatingQualified: health?.seatingQualified,
    inventoryFrozen: health?.inventoryFrozen,
    officialStandbysReady: health?.officialStandbysReady ?? sq.officialStandbysReady ?? null,
    officialStandbyReadyCount: health?.officialStandbyReadyCount ?? sq.officialStandbyReadyCount ?? null,
    standbyReadyEip712: health?.standbyReadyEip712 ?? sq.standbyReadyEip712 ?? null,
    seatingEip712: health?.seatingEip712 ?? sq.seatingEip712 ?? null,
    challengeEip712: health?.challengeEip712 ?? sq.challengeEip712 ?? null,
    bftEip712: health?.bftEip712 ?? null,
    ondemandEip712: health?.ondemandEip712 ?? null,
    newchainOfficialStandbysReady: health?.newchainOfficialStandbysReady ?? null,
    hashIndexCommittedInAc: health?.hashIndexCommittedInAc ?? null,
  }
}

const evidence = {
  schema: 'DleLabP23Newchain409AcceptV1',
  labOnly: true,
  notThirtyDayQualification: true,
  notProductionDepin: true,
  request: REQUEST,
  startedAt: new Date().toISOString(),
  deny: null,
  accept: null,
}

writeFileSync(`${OUT_DIR}/p23-newchain-request.json`, `${JSON.stringify(REQUEST, null, 2)}\n`)

let denySaved = false
let acceptSaved = false
const deadline = Date.now() + 45 * 60 * 1000

while (Date.now() < deadline && (!denySaved || !acceptSaved)) {
  let health
  try {
    const got = await getJson(`${FD01}/health`)
    health = got.body
  } catch (error) {
    console.log(new Date().toISOString(), 'fd-01 health fail', error instanceof Error ? error.message : error)
    await sleep(8000)
    continue
  }
  const o = overlay(health)
  const readyKnown = typeof o.officialStandbysReady === 'boolean'
  console.log(
    new Date().toISOString(),
    JSON.stringify({
      readyKnown,
      officialStandbysReady: o.officialStandbysReady,
      count: o.officialStandbyReadyCount,
      seatingQualified: o.seatingQualified,
      inventoryFrozen: o.inventoryFrozen,
      denySaved,
      acceptSaved,
    }),
  )
  if (!readyKnown) {
    await sleep(8000)
    continue
  }
  if (!denySaved && o.officialStandbysReady === false) {
    const posted = await postJson(`${FD01}/newchain/request`, REQUEST)
    evidence.deny = {
      capturedAt: new Date().toISOString(),
      overlay: o,
      httpStatus: posted.status,
      body: posted.body,
    }
    writeFileSync(`${OUT_DIR}/p23-newchain-409.json`, `${JSON.stringify(evidence.deny, null, 2)}\n`)
    denySaved = posted.status === 409 && posted.body?.error === 'ERR_NEWCHAIN_STANDBY_NOT_READY'
    console.log('deny', posted.status, posted.body?.error, 'saved=', denySaved)
  }
  if (!acceptSaved && o.officialStandbysReady === true) {
    const posted = await postJson(`${FD01}/newchain/request`, REQUEST)
    evidence.accept = {
      capturedAt: new Date().toISOString(),
      overlay: o,
      httpStatus: posted.status,
      body: posted.body,
    }
    writeFileSync(`${OUT_DIR}/p23-newchain-accept.json`, `${JSON.stringify(evidence.accept, null, 2)}\n`)
    acceptSaved = posted.status === 200 && posted.body?.ok === true
    console.log('accept', posted.status, posted.body?.ok, posted.body?.error, 'saved=', acceptSaved)
  }
  writeFileSync(`${OUT_DIR}/p23-newchain-409-accept.json`, `${JSON.stringify(evidence, null, 2)}\n`)
  if (denySaved && acceptSaved) break
  await sleep(8000)
}

evidence.finishedAt = new Date().toISOString()
evidence.ok = denySaved && acceptSaved
writeFileSync(`${OUT_DIR}/p23-newchain-409-accept.json`, `${JSON.stringify(evidence, null, 2)}\n`)
console.log('done', evidence.ok, 'deny=', denySaved, 'accept=', acceptSaved)
process.exit(evidence.ok ? 0 : 2)
