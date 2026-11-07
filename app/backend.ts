// Server-only helpers for the /api routes. They call the same modules the voice server uses.
import { env, owner } from '../src/config.ts';
import { db, type Job } from '../src/store.ts';

export { env, owner, db };
export const json = (body: unknown, status = 200) => Response.json(body, { status });

// A job's public view: what the payer needs, nothing about other customers.
export const publicJob = (j: Job) => ({
  id: j.id, business: owner().business.name, service: j.serviceName, quotedUsd: j.quotedUsd, depositUsd: j.depositUsd,
  name: j.caller.name, payout: owner().payout.asset_symbol, payment: j.payment ?? null,
});
export type PublicJob = ReturnType<typeof publicJob>;
export const findJob = (id: string) => db.jobs.find((j) => j.id === id);
