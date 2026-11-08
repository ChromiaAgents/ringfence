// One JSON file is the whole database. ponytail: fine for a demo and a few hundred calls; swap for SQLite if it grows.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Proof } from './ai.ts';
import type { LaunchParams } from './near.ts';
import type { Binding } from './wallet.ts';

export type Desk = 'launch' | 'wallet';
/** Per-turn latency in ms, all counted from `start` (when the caller's utterance reached the server). */
export type Timing = { start?: number; sttMs?: number; firstTokenMs?: number; firstAudioMs?: number; llmMs?: number; totalMs?: number };
export type Turn = { at: number; who: 'caller' | 'agent' | 'tool'; text: string; proof?: Proof; timing?: Timing };
export type Call = {
  id: string; channel: 'web' | 'whatsapp'; desk?: Desk; from?: string; startedAt: number; endedAt?: number; turns: Turn[];
  caller?: Record<string, string>; launchId?: string; routeMisses?: number;
};
export const isCurrentLaunch = (l: { launchpad?: string }) => l.launchpad === 'justhoot';

export type Launch = {
  id: string; callId: string; createdAt: number; network: 'mainnet' | 'testnet'; params: LaunchParams;
  launchpad?: 'justhoot'; // missing on rows from the retired launchpad: kept in the DB, never shown or signed
  logoModel?: string; status: 'prepared' | 'signed' | 'live' | 'failed';
  signer?: string; txHash?: string; tokenId?: string; reason?: string;
};
export type LedgerEntry = {
  at: number;
  kind: 'refused' | 'launch_prepared' | 'launch_signed' | 'logo' | 'filtered' | 'wallet';
  desk?: Desk; callId?: string; launchId?: string; detail: string;
};

type Db = { calls: Call[]; launches: Launch[]; ledger: LedgerEntry[]; wallets: Binding[] };
const FILE = process.env.DB_FILE ?? 'data/db.json';

function load(): Db {
  const d = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  return { calls: [], launches: [], ledger: [], wallets: [], ...d };
}
// Shared through globalThis: the Node server (voice, WhatsApp) and the TanStack Start routes run in one process
// but may load this module twice (Vite's SSR runner in dev, the built server bundle in prod).
export const db: Db = ((globalThis as any).__callhandDb ??= load());
export function save() {
  mkdirSync(FILE.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 1));
}

export const id = () => randomUUID().slice(0, 8);
export function log(e: Omit<LedgerEntry, 'at'>) {
  db.ledger.push({ at: Date.now(), ...e });
  save();
}
