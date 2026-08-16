#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import {
  LAB_CLASS_ASSET,
  LAB_CLASS_STORAGE,
  LAB_CLASS_TRADE,
  LAB_NEWCHAIN_NOTE,
  LAB_NEWCHAIN_USER,
  classNameOf,
  labChainNftIdFromRequestId,
  makeNewChainRequest,
  newChainRequestId,
  type LabChainClassId,
  type LabChainClassName,
} from '../shared/newchain.js'
import type { Hex } from '../shared/bytes.js'

const MIN_DELAY_MS = 15_000
const MAX_DELAY_MS = 45_000
const POST_TIMEOUT_MS = 12_000
const CLASSES: LabChainClassId[] = [LAB_CLASS_ASSET, LAB_CLASS_STORAGE, LAB_CLASS_TRADE]

interface ArchivesFile {
  schema: string
  archives: string[]
}

interface SubmittedChain {
  requestId: Hex
  chainNftId: string
  classId: LabChainClassId
  className: LabChainClassName
  valueHash: Hex
  tipStateRoot: Hex
  acceptedAt: string
  archiveOk: number
  archiveTotal: number
  duplicate: boolean
}

interface UserStatus {
  schema: 'DleLabNewChainUserStatusV1'
  labOnly: true
  notProductionDepin: true
  notL1Nft: true
  note: typeof LAB_NEWCHAIN_NOTE
  user: Hex
  nextNonce: string
  submitted: SubmittedChain[]
  lastError: string | null
  genesisSmoke: Record<LabChainClassName, SubmittedChain | null>
}

interface ParsedArgs {
  archivesFile: string
  dataDir: string
}

function parseArgs(argv: string[]): ParsedArgs {
  let archivesFile = ''
  let dataDir = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--archives-file' && next !== undefined) {
      archivesFile = resolve(next)
      i += 1
      continue
    }
    if (arg === '--data-dir' && next !== undefined) {
      dataDir = resolve(next)
      i += 1
    }
  }
  if (archivesFile === '' || dataDir === '') {
    throw new Error('usage: newchain-user-cli.js --archives-file FILE --data-dir DIR')
  }
  return { archivesFile, dataDir }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function randomSalt(): Hex {
  return `0x${randomBytes(32).toString('hex')}` as Hex
}

function randomDelayMs(): number {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
}

function randomClass(): LabChainClassId {
  return CLASSES[Math.floor(Math.random() * CLASSES.length)] ?? LAB_CLASS_TRADE
}

function loadArchives(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ArchivesFile
  if (!Array.isArray(parsed.archives) || parsed.archives.length === 0) {
    throw new Error('archives file must list HTTP archive URLs')
  }
  return parsed.archives.map((url) => url.replace(/\/$/, ''))
}

function emptyStatus(): UserStatus {
  return {
    schema: 'DleLabNewChainUserStatusV1',
    labOnly: true,
    notProductionDepin: true,
    notL1Nft: true,
    note: LAB_NEWCHAIN_NOTE,
    user: LAB_NEWCHAIN_USER,
    nextNonce: '1',
    submitted: [],
    lastError: null,
    genesisSmoke: { asset: null, storage: null, trade: null },
  }
}

function parseSubmitted(value: unknown): SubmittedChain | null {
  if (!isRecord(value)) return null
  if (typeof value.requestId !== 'string' || typeof value.chainNftId !== 'string') return null
  if (value.classId !== LAB_CLASS_ASSET && value.classId !== LAB_CLASS_STORAGE && value.classId !== LAB_CLASS_TRADE) {
    return null
  }
  const className = classNameOf(value.classId)
  if (className === null || value.className !== className) return null
  if (typeof value.valueHash !== 'string' || typeof value.tipStateRoot !== 'string') return null
  if (typeof value.acceptedAt !== 'string') return null
  return {
    requestId: value.requestId as Hex,
    chainNftId: value.chainNftId,
    classId: value.classId,
    className,
    valueHash: value.valueHash as Hex,
    tipStateRoot: value.tipStateRoot as Hex,
    acceptedAt: value.acceptedAt,
    archiveOk: typeof value.archiveOk === 'number' ? value.archiveOk : 0,
    archiveTotal: typeof value.archiveTotal === 'number' ? value.archiveTotal : 0,
    duplicate: value.duplicate === true,
  }
}

function loadStatus(path: string): UserStatus {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(parsed) || parsed.schema !== 'DleLabNewChainUserStatusV1') return emptyStatus()
    const next = emptyStatus()
    if (typeof parsed.nextNonce === 'string' && /^\d+$/.test(parsed.nextNonce)) next.nextNonce = parsed.nextNonce
    if (Array.isArray(parsed.submitted)) {
      next.submitted = parsed.submitted.map(parseSubmitted).filter((row): row is SubmittedChain => row !== null)
    }
    if (isRecord(parsed.genesisSmoke)) {
      for (const name of ['asset', 'storage', 'trade'] as const) {
        const row = parseSubmitted(parsed.genesisSmoke[name])
        if (row !== null) next.genesisSmoke[name] = row
      }
    }
    if (typeof parsed.lastError === 'string') next.lastError = parsed.lastError
    return next
  } catch {
    return emptyStatus()
  }
}

async function postArchive(url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}/newchain/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  })
  const parsed = (await response.json()) as unknown
  if (!isRecord(parsed)) throw new Error(`${url} returned a non-object`)
  if (response.ok !== true || parsed.ok !== true) {
    throw new Error(`${url} rejected: ${typeof parsed.error === 'string' ? parsed.error : response.status}`)
  }
  return parsed
}

const options = parseArgs(process.argv.slice(2))
mkdirSync(options.dataDir, { recursive: true })
const statusPath = resolve(options.dataDir, 'status.json')
const archives = loadArchives(options.archivesFile)
const status = loadStatus(statusPath)

function persist(): void {
  writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
}

async function submitClass(classId: LabChainClassId): Promise<SubmittedChain> {
  const className = classNameOf(classId)
  if (className === null) throw new Error('invalid classId')
  const request = makeNewChainRequest({
    classId,
    nonce: status.nextNonce,
    salt: randomSalt(),
    createdAt: new Date().toISOString(),
  })
  const requestId = newChainRequestId(request)
  const expectedNft = labChainNftIdFromRequestId(requestId)
  const replies = await Promise.all(archives.map((url) => postArchive(url, request)))
  const first = replies[0]
  if (first === undefined) throw new Error('no archive replies')
  const chainNftId = String(first.chainNftId)
  const valueHash = String(first.valueHash)
  const tipStateRoot = String(first.tipStateRoot)
  for (const reply of replies) {
    if (String(reply.requestId).toLowerCase() !== requestId.toLowerCase()) {
      throw new Error('archives disagreed on requestId')
    }
    if (String(reply.chainNftId) !== chainNftId || chainNftId !== expectedNft) {
      throw new Error('archives disagreed on chainNftId')
    }
    if (String(reply.valueHash).toLowerCase() !== valueHash.toLowerCase()) {
      throw new Error('archives disagreed on valueHash')
    }
  }
  const row: SubmittedChain = {
    requestId,
    chainNftId,
    classId,
    className,
    valueHash: valueHash.toLowerCase() as Hex,
    tipStateRoot: tipStateRoot.toLowerCase() as Hex,
    acceptedAt: new Date().toISOString(),
    archiveOk: replies.length,
    archiveTotal: archives.length,
    duplicate: replies.every((reply) => reply.duplicate === true),
  }
  status.nextNonce = (BigInt(status.nextNonce) + 1n).toString(10)
  status.submitted.push(row)
  if (status.genesisSmoke[className] === null) status.genesisSmoke[className] = row
  status.lastError = null
  persist()
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      className,
      requestId,
      chainNftId,
      valueHash: row.valueHash,
      archiveOk: row.archiveOk,
    })}\n`,
  )
  return row
}

async function submitGenesisSmoke(): Promise<void> {
  for (const classId of CLASSES) {
    const name = classNameOf(classId)
    if (name !== null && status.genesisSmoke[name] !== null) continue
    await submitClass(classId)
  }
}

function scheduleRandom(): void {
  const delayMs = randomDelayMs()
  setTimeout(() => {
    void (async () => {
      try {
        await submitClass(randomClass())
      } catch (error) {
        status.lastError = error instanceof Error ? error.message : String(error)
        persist()
        process.stderr.write(`${JSON.stringify({ ok: false, error: status.lastError })}\n`)
      } finally {
        scheduleRandom()
      }
    })()
  }, delayMs)
}

persist()
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    started: true,
    labOnly: true,
    notL1Nft: true,
    user: LAB_NEWCHAIN_USER,
    archives: archives.length,
    dataDir: options.dataDir,
  })}\n`,
)

void submitGenesisSmoke()
  .then(() => {
    scheduleRandom()
  })
  .catch((error: unknown) => {
    status.lastError = error instanceof Error ? error.message : String(error)
    persist()
    process.stderr.write(`${JSON.stringify({ ok: false, stage: 'genesis-smoke', error: status.lastError })}\n`)
    process.exitCode = 1
  })
