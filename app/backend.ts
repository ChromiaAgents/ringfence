// Server-only helpers for the /api routes. They call the same modules the voice server uses.
import { env, launchpad } from '../src/config.ts';
import { db, isCurrentLaunch, type Launch } from '../src/store.ts';
import { net } from '../src/near.ts';
import { JUSTHOOT } from '../src/justhoot.ts';

export { env, launchpad, db };
export const json = (body: unknown, status = 200) => Response.json(body, { status });

// A launch's public view: the parameters the caller agreed, where it goes, and its state.
export const publicLaunch = (l: Launch) => ({
  id: l.id, network: l.network, contract: JUSTHOOT.contract,
  status: l.status, params: l.params, logoModel: l.logoModel ?? null,
  signer: l.signer ?? null, txHash: l.txHash ?? null, reason: l.reason ?? null,
  tokenId: l.tokenId ?? null, tokenUrl: l.tokenId ? JUSTHOOT.tokenUrl(l.tokenId) : null,
  txUrl: l.txHash ? net(l.network).explorer(l.txHash) : null,
});
export type PublicLaunch = ReturnType<typeof publicLaunch>;
export const findLaunch = (id: string) => db.launches.find((l) => l.id === id && isCurrentLaunch(l));

// Everything the dashboard shows. Icons are dropped from the list (the launch page has them).
export async function attestationAll(fresh = false) {
  const { attest } = await import('../src/ai.ts');
  const models = [env.llmModel, env.sttModel, env.imageModel];
  return Promise.all(models.map((m) => attest(m, fresh).catch((e: any) => ({ model: m, error: String(e.message) }))));
}

export async function snapshot(withAttestation = true) {
  const models = [env.llmModel, env.sttModel, env.imageModel];
  const attestation = withAttestation
    ? await attestationAll()
    : models.map((m) => ({ model: m, error: 'pending' })); // first paint doesn't wait on the attestation service
  return JSON.parse(JSON.stringify({
    launchpad: launchpad(), network: env.network, attestation, model: env.llmModel,
    calls: db.calls.slice(-30).reverse(),
    launches: db.launches.filter(isCurrentLaunch).slice(-30).reverse().map((l) => ({ ...l, params: { ...l.params, icon: undefined } })),
    ledger: db.ledger.slice(-150).reverse(),
  }));
}
