// One JSON file is the whole database. ponytail: fine for a demo and a few hundred calls; swap for SQLite if it grows.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Proof } from './ai.ts';
import type { Quote } from './pay.ts';

export type Turn = { at: number; who: 'caller' | 'agent' | 'tool'; text: string; proof?: Proof };
export type Call = { id: string; channel: 'web' | 'whatsapp'; from?: string; startedAt: number; endedAt?: number; turns: Turn[]; caller?: Record<string, string>; jobId?: string };
export type Job = {
  id: string; callId: string; serviceId: string; serviceName: string; quotedUsd: number; discountPct: number;
  depositUsd: number; preferredDate?: string; notes?: string; caller: Record<string, string>; createdAt: number;
  payment?: { quote: Quote; status: string; updatedAt: number; originSymbol: string; chain: string };
};
export type LedgerEntry = { at: number; kind: 'quote' | 'refused' | 'booking' | 'deposit_link' | 'payment' | 'message'; jobId?: string; callId?: string; detail: string };

type Db = { calls: Call[]; jobs: Job[]; ledger: LedgerEntry[] };
const FILE = process.env.DB_FILE ?? 'data/db.json';

function load(): Db {
  if (!existsSync(FILE)) return { calls: [], jobs: [], ledger: [] };
  return JSON.parse(readFileSync(FILE, 'utf8'));
}
export const db: Db = load();
export function save() {
  mkdirSync(FILE.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 1));
}

export const id = () => randomUUID().slice(0, 8);
export function log(e: Omit<LedgerEntry, 'at'>) {
  db.ledger.push({ at: Date.now(), ...e });
  save();
}
