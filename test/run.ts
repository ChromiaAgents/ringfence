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
const t = async (name: string, f: () => void | Promise<void>) => { await f(); n++; console.log('ok', name); };
const lp = launchpad();

await t('returning caller is remembered and resumes their coin', async () => {
  const { startCall } = await import('../src/agent.ts');
  const { launchDesk } = await import('../src/desks/launch.ts');
  const from = '15550000001';
  const first = startCall('whatsapp', from).call;
  first.turns.push({ at: Date.now(), who: 'caller', text: 'a coin about my cat' });
  await launchDesk.run(first, 'set_coin', { name: 'Whisker Coin', ticker: 'WHISK', description: 'a cat' });
  const again = startCall('whatsapp', from);
  assert.equal(again.call.desk, 'launch', 'resumed to launch desk');
  assert.match(again.greeting, /WHISK/);
  assert.match(launchDesk.system(again.call) + (await import('../src/memory.ts')).recap(again.call), /called before/);
});
await t('emoji and markdown are never spoken', async () => {
  const { speakable } = await import('../src/tts.ts');
  assert.equal(speakable('Nice! 🐱🚀 Your **WHISK** coin ✨'), 'Nice! Your WHISK coin');
});

await t('justhoot args + ticker rule', async () => {
  const { justhootArgs } = await import('../src/justhoot.ts');
  const { justhootRules } = await import('../src/desks/launch.ts');
  const a = justhootArgs({ name: 'Sleepy Otter', symbol: 'ZZZ', icon: 'data:image/webp;base64,AA' });
  assert.equal(a.quote_token_id, 'wrap.near');
  assert.equal(a.dev_buy_quote_max, null);
  assert.equal(a.transfer_fee_pips, 0);
  assert.equal(a.reference, null);
  assert.deepEqual(a.shares, { token_owner_bps: 10000, burn_bps: 0, holders_bps: 0 });
  const jr = justhootRules(lp);
  assert.equal(checkTicker('Z', jr).ok, true);
  assert.equal(checkTicker('TENLETTERS', jr).ok, true);
  assert.equal(checkTicker('ELEVENCHARS', jr).ok, false);
  assert.equal(checkTicker('NEAR', jr).ok, false); // blocked tickers still apply
});
await t('justhoot: no auction, and prepare_launch builds launch_meme from the views', async () => {
  const { startCall } = await import('../src/agent.ts');
  const { launchDesk } = await import('../src/desks/launch.ts');
  const { justhootArgs, justhootCost, buildJustHootTx } = await import('../src/justhoot.ts');
  const { drawLogo } = await import('../src/image.ts');
  const { db } = await import('../src/store.ts');
  const call = startCall('whatsapp', '15550000002').call;
  call.turns.push({ at: Date.now(), who: 'caller', text: 'an owl coin' });
  assert.equal(((await launchDesk.run(call, 'set_launchpad', { launchpad: 'justhoot' })) as any).ok, true);
  assert.equal(((await launchDesk.run(call, 'set_auction', { duration_minutes: 60, soft_cap_near: 10 })) as any).ok, false);
  assert.equal(((await launchDesk.run(call, 'set_team_allocation', { pct: 5 })) as any).ok, false);
  assert.equal(((await launchDesk.run(call, 'set_coin', { name: 'Elon Hoot', ticker: 'HOOT' })) as any).ok, false);
  assert.equal(((await launchDesk.run(call, 'set_coin', { name: 'Night Owl', ticker: 'HOOTHOOT1', description: 'owl' })) as any).ok, true);
  const { draftOf } = await import('../src/desks/launch.ts');
  Object.assign(draftOf(call.id), { icon: (await drawLogo('HOOT')).icon });
  const r: any = await launchDesk.run(call, 'prepare_launch', { caller_confirmed: true });
  assert.equal(r.ok, true, r.reason);
  const l = db.launches.find((x) => x.id === call.launchId)!;
  assert.equal(l.launchpad, 'justhoot');
  assert.equal(l.network, 'mainnet');
  assert.ok(l.params.icon.length <= 7000);
  const views: Record<string, unknown> = { get_launch_deposit: '58080000000000000000000', get_launch_gas: '456', storage_balance_of: null, storage_balance_bounds: { min: '2170000000000000000000' }, get_next_token_id: 'hoothoot1.v2-launchpad.justhoot.near' };
  const args = justhootArgs(l.params);
  const cost = await justhootCost(args, 'owl.near', (async (m: string) => views[m]) as any);
  const tx = buildJustHootTx(args, cost);
  assert.equal(tx.receiverId, 'v2-launchpad.justhoot.near');
  assert.deepEqual(tx.actions.map((a) => a.methodName), ['storage_deposit', 'launch_meme']);
  assert.equal(tx.actions[1].gas, '456000000000000');
  assert.equal(tx.actions[1].deposit, '58080000000000000000000');
  assert.deepEqual(tx.actions[1].args, { args });
  assert.equal(cost.totalYocto, '60250000000000000000000');
  const again = startCall('whatsapp', '15550000002').call;
  assert.match((await import('../src/memory.ts')).recap(again), /on JustHoot/);
});

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
process.once("beforeExit", () => console.log(`${n} passed`));
