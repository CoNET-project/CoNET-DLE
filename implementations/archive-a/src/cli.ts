#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  ArchiveLifecycleState,
  Certificate,
  CONTAINERS,
  CoordinatorInput,
  DleError,
  DleProtocolError,
  Hex,
  LifecycleInput,
  TendermintInput,
  TendermintState,
  WalFrame,
  applyLifecycleInput,
  applyTendermintInput,
  bytesToHex,
  certificateContainer,
  certificateRef,
  decodeWal,
  encodeRs74,
  encodeWalFrame,
  hashTreeRoot,
  hexToBytes,
  lifecycleStateRoot,
  reconstructRs74,
  selectCoordinator,
  serializeContainer,
  signingRoot,
  tendermintStateRoot,
  validateCertificate
} from "./core.js";

interface Request {
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface Response {
  id?: string | number;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}

function params(request: Request): Record<string, unknown> {
  return request.params ?? {};
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer`);
  }
  return value;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function hydrateContainer(
  container: keyof typeof CONTAINERS,
  raw: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    CONTAINERS[container].map(([name, type]) => {
      const value = raw[name];
      if (type === "uint64" || type === "uint256") return [name, BigInt(asString(value, name))];
      return [name, value];
    })
  );
}

function hydrateCertificate(raw: Record<string, unknown>): Certificate {
  const kind = asNumber(raw.kind, "kind");
  const probe = { ...raw, kind } as unknown as Certificate;
  const container = certificateContainer(probe);
  return hydrateContainer(container, raw) as unknown as Certificate;
}

function replayFsm(initial: TendermintState, inputs: readonly TendermintInput[]): object {
  let state = initial;
  const outputs: unknown[] = [];
  const errors: DleError[] = [];
  for (const input of inputs) {
    const transition = applyTendermintInput(state, input);
    state = transition.state;
    outputs.push(...transition.outputs);
    if (transition.error !== undefined) errors.push(transition.error);
  }
  return { state, outputs, errors, stateRoot: tendermintStateRoot(state) };
}

function replayLifecycle(initial: ArchiveLifecycleState, inputs: readonly LifecycleInput[]): object {
  let state = initial;
  for (const input of inputs) state = applyLifecycleInput(state, input);
  return { state, stateRoot: lifecycleStateRoot(state) };
}

export function handleRequest(request: Request): unknown {
  const input = params(request);
  switch (request.method) {
    case "health":
      return {
        implementation: "archive-a",
        protocol: "dle.archive.tendermint.corpus.v2"
      };
    case "container.derive": {
      const container = asString(input.container, "container") as keyof typeof CONTAINERS;
      if (!(container in CONTAINERS)) throw new Error("Unknown container");
      const object = hydrateContainer(container, asRecord(input.object, "object"));
      return {
        canonicalSsz: bytesToHex(serializeContainer(container, object)),
        hashTreeRoot: hashTreeRoot(container, object),
        signingRoot: signingRoot(container, object)
      };
    }
    case "certificate.validate": {
      const certificate = hydrateCertificate(asRecord(input.certificate, "certificate"));
      validateCertificate(certificate);
      return {
        valid: true,
        certificateRef: certificateRef(certificate)
      };
    }
    case "coordinator.select": {
      const roster = input.roster;
      if (!Array.isArray(roster) || !roster.every((item) => typeof item === "string")) {
        throw new Error("roster must be an array of hex strings");
      }
      const raw = asRecord(input.input, "input");
      const coordinatorInput: CoordinatorInput = {
        archiveGroupId: BigInt(asString(raw.archiveGroupId, "archiveGroupId")),
        chainNftId: BigInt(asString(raw.chainNftId, "chainNftId")),
        tipHeight: BigInt(asString(raw.tipHeight, "tipHeight")),
        attemptNonce: BigInt(asString(raw.attemptNonce, "attemptNonce")),
        membershipRoot: asString(raw.membershipRoot, "membershipRoot") as Hex,
        round: asNumber(raw.round, "round")
      };
      return selectCoordinator(roster as Hex[], coordinatorInput);
    }
    case "wal.encode": {
      const frame: WalFrame = {
        sequence: BigInt(asString(input.sequence, "sequence")),
        flags: asNumber(input.flags, "flags"),
        payload: hexToBytes(asString(input.payload, "payload"))
      };
      return { frame: bytesToHex(encodeWalFrame(frame)) };
    }
    case "wal.decode": {
      const decoded = decodeWal(hexToBytes(asString(input.frame, "frame")));
      return {
        frames: decoded.frames,
        recoveryRequired: decoded.recoveryRequired,
        validBytes: decoded.validBytes
      };
    }
    case "rs.encode": {
      const encoded = encodeRs74(hexToBytes(asString(input.body, "body")));
      return encoded;
    }
    case "rs.reconstruct": {
      const shards = input.shards;
      if (!Array.isArray(shards)) throw new Error("shards must be an array");
      return {
        body: bytesToHex(
          reconstructRs74(
            shards.map((item, index) => {
              const shard = asRecord(item, `shards[${index}]`);
              return {
                index: asNumber(shard.index, "index"),
                bytes: hexToBytes(asString(shard.bytes, "bytes"))
              };
            })
          )
        )
      };
    }
    case "fsm.replay": {
      const initial = asRecord(input.initial, "initial") as unknown as TendermintState;
      if (!Array.isArray(input.inputs)) throw new Error("inputs must be an array");
      return replayFsm(initial, input.inputs as TendermintInput[]);
    }
    case "lifecycle.replay": {
      const initial = asRecord(input.initial, "initial") as unknown as ArchiveLifecycleState;
      if (!Array.isArray(input.inputs)) throw new Error("inputs must be an array");
      return replayLifecycle(initial, input.inputs as LifecycleInput[]);
    }
    default:
      throw new Error(`Unknown method: ${request.method}`);
  }
}

export function processLine(line: string): Response {
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch {
    return {
      ok: false,
      error: { code: "ERR_INVALID_REQUEST", message: "Input must be one JSON object per line" }
    };
  }
  try {
    return {
      ...(request.id === undefined ? {} : { id: request.id }),
      ok: true,
      result: jsonSafe(handleRequest(request))
    };
  } catch (error) {
    const protocolError = error instanceof DleProtocolError ? error : null;
    return {
      ...(request.id === undefined ? {} : { id: request.id }),
      ok: false,
      error: {
        code: protocolError?.code ?? "ERR_INVALID_REQUEST",
        message: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    process.stdout.write(`${JSON.stringify(processLine(line))}\n`);
  });
}
