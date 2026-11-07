// Offline rule tests: the code that refuses things, without any model in the loop. `npm test`
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTicker, checkName, checkAuction, checkTeam, filterClaims } from '../src/desks/launch.ts';
import { isFiller } from '../src/agent.ts';
import { planChange, applyDiff } from '../src/desks/owner.ts';
import { priceFor } from '../src/desks/business.ts';
import { route } from '../src/agent.ts';
import { sentenceSplitter } from '../src/speech.ts';
import { createMemeArgs } from '../src/memecook.ts';
import { launchpad, owner } from '../src/config.ts';

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log('ok', name); };
const lp = launchpad();

t('thinking noises are not turns', () => {
  for (const s of ['Um...', 'uh', 'Hmm.', 'Erm, uh', 'mm']) assert.ok(isFiller(s), s);
  for (const s of ['um, a cat coin', 'yes', 'Umbrella']) assert.ok(!isFiller(s), s);
});

t('ticker format', () => {
  assert.equal(checkTicker('$doge2', lp).ok, true);
  assert.equal(checkTicker('A', lp).ok, false);
  assert.equal(checkTicker('TOOLONGTICK', lp).ok, false);
  assert.equal(checkTicker('ab-c', lp).ok, false);
});
t('ticker impersonation', () => {
  for (const x of ['NEAR', 'usdc', '$BTC', 'PEPE', 'TRUMP', 'ELONCAT', 'TESLA']) assert.equal(checkTicker(x, lp).ok, false, x);
  assert.equal(checkTicker('CATS', lp, [{ symbol: 'cats' }]).ok, false);
});
t('name impersonation', () => {
  assert.equal(checkName('Elon Musk Inu', lp).ok, false);
  assert.equal(checkName('Bitcoin Cat', lp).ok, false);
  assert.equal(checkName('Sleepy Otter', lp).ok, true);
  assert.equal(checkName('Metaphor', lp).ok, true); // "meta" only blocks as a whole word
});
t('auction bounds', () => {
  assert.equal(checkAuction({ durationMinutes: 60, softCapNear: 100 }, lp).ok, true);
  assert.equal(checkAuction({ durationMinutes: 2, softCapNear: 100 }, lp).ok, false);
  assert.equal(checkAuction({ durationMinutes: 2000, softCapNear: 100 }, lp).ok, false);
  assert.equal(checkAuction({ durationMinutes: 60, softCapNear: 1 }, lp).ok, false);
  assert.equal(checkAuction({ durationMinutes: 60, softCapNear: 100, hardCapNear: 50 }, lp).ok, false);
});
t('team allocation', () => {
  assert.equal(checkTeam({ pct: 0, cliffDays: 0, vestingDays: 0 }, lp).ok, true);
  assert.equal(checkTeam({ pct: 5, cliffDays: 7, vestingDays: 30 }, lp).ok, true);
  assert.equal(checkTeam({ pct: 25, cliffDays: 30, vestingDays: 90 }, lp).ok, false);
  assert.equal(checkTeam({ pct: 5, cliffDays: 1, vestingDays: 30 }, lp).ok, false);
  assert.equal(checkTeam({ pct: 5, cliffDays: 7, vestingDays: 3 }, lp).ok, false);
});
t('no promised returns', () => {
  assert.ok(filterClaims('This will 100x for sure', lp).hit);
  assert.ok(filterClaims("It's guaranteed to pump", lp).hit);
  assert.equal(filterClaims('Your soft cap is 100 NEAR.', lp).hit, undefined);
});
t('router', () => {
  assert.equal(route('I want to launch a memecoin'), 'launch');
  assert.equal(route('my bathroom tap is leaking'), 'business');
  assert.equal(route('hello?'), null);
});
t('create_meme args', () => {
  const a = createMemeArgs({ name: 'Sleepy Otter', symbol: 'ZZZ', description: 'naps', icon: 'data:image/webp;base64,AA', durationMinutes: 60, softCapNear: 100, team: { pct: 5, cliffDays: 7, vestingDays: 30 }, totalSupply: '1000000000', decimals: 18 }, { reference: '', reference_hash: '' }, 'testnet');
  assert.equal(a.duration_ms, '3600000');
  assert.equal(a.total_supply, '1000000000' + '0'.repeat(18));
  assert.equal(a.soft_cap, '100' + '0'.repeat(24));
  assert.deepEqual(a.team_allocation, [500, 30 * 86_400_000, 7 * 86_400_000]);
  assert.equal(a.deposit_token_id, 'wrap.testnet');
});
t('business pricing rules', () => {
  assert.equal(priceFor('kitchen', 'medium', 30).ok, false);
  assert.equal(priceFor('kitchen', 'medium', 5).ok, true);
});
t('owner desk bounds + write', () => {
  const o = owner();
  assert.equal(planChange({ max_discount_pct: 90 }, o).ok, false);
  assert.equal(planChange({ deposit_pct: 5 }, o).ok, false);
  assert.equal(planChange({ min_deposit_usd: 400, max_deposit_usd: 100 }, o).ok, false);
  const p = planChange({ max_discount_pct: 15, refuse_work_add: ['roofs'], service_prices: [{ id: 'repair', from_usd: 150, to_usd: 150 }] }, o);
  assert.ok(p.ok);
  const f = join(mkdtempSync(join(tmpdir(), 'callhand-')), 'owner.yaml');
  copyFileSync('owner.yaml', f);
  applyDiff(p.diff, f);
  const out = readFileSync(f, 'utf8');
  assert.match(out, /max_discount_pct: 15/);
  assert.match(out, /- roofs/);
  assert.match(out, /\$\{OWNER_NEAR_ACCOUNT\}/); // placeholder kept, secret never written
  assert.match(out, /# the agent may never offer more than this/); // comments kept
});
t('streamed sentences + per-sentence filter', () => {
  const out: string[] = [];
  const sp = sentenceSplitter((x) => filterClaims(x, lp));
  for (const tok of '<think>plan</think>Sure, the soft cap is 2.5 NEAR. What ticker? It will 100x for sure. Ignore me.'.match(/.{1,4}/gs)!) out.push(...sp.push(tok));
  out.push(...sp.flush());
  assert.equal(out[0], 'Sure, the soft cap is 2.5 NEAR.');
  assert.equal(out[1], 'What ticker?');
  assert.equal(out.length, 3); // after the filtered sentence nothing else is spoken
  assert.match(out[2], /can't make any promises/);
  assert.ok(!out.some((x) => /100x|Ignore|think|plan/.test(x)));
});
console.log(`${n} passed`);
