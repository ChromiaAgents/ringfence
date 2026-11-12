// Writes a demo database for screenshots and UI work. Never committed (data/ is git-ignored).
// Usage: npm run seed            -> data/demo-db.json
//        DB_FILE=data/demo-db.json npm run dev
import { writeFileSync, mkdirSync } from 'node:fs';
import { drawLogo } from '../src/image.ts';

const FILE = process.env.SEED_FILE ?? 'data/demo-db.json';
const t0 = Date.now() - 3 * 3600_000;
const m = (min: number) => t0 + min * 60_000;
const proof = (n: number) => ({ chatId: `demo-${n}`, model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', requestHash: '0x', responseHash: '0x', status: 'verified', signer: '0x0000000000000000000000000000000000000000', kind: 'ecdsa' });

const G = 'Hey, Ringfence here, on NEAR. I can send NEAR or dollars, make or open a money packet, top up from another chain, or check prices and news. What do you need?';
const calls = [
  {
    id: 'c4', channel: 'whatsapp', desk: 'launch', from: '447700900456', startedAt: m(150), endedAt: m(156), launchId: 'l1',
    turns: [
      { at: m(150), who: 'agent', text: G },
      { at: m(150.3), who: 'caller', text: 'I want to launch a memecoin about a sleepy otter.' },
      { at: m(150.3), who: 'tool', text: 'routed to the launch desk' },
      { at: m(150.5), who: 'agent', text: 'Love it. What should the coin be called, and what ticker?', proof: proof(9) },
      { at: m(151), who: 'caller', text: 'Ticker NEAR, name Sleepy Otter.' },
      { at: m(151.1), who: 'tool', text: 'set_coin({"name":"Sleepy Otter","ticker":"NEAR"}) → {"ok":false,"reason":"NEAR is the ticker of an existing asset; launching it would look like impersonation."}' },
      { at: m(151.2), who: 'agent', text: "I can't use NEAR, it's an existing asset's ticker. How about something of your own?", proof: proof(10) },
      { at: m(151.6), who: 'caller', text: 'ZZZ then.' },
      { at: m(151.8), who: 'agent', text: 'ZZZ is free. What vibe for the logo?', proof: proof(11) },
      { at: m(152.4), who: 'caller', text: 'Will it 100x?' },
      { at: m(152.5), who: 'agent', text: "I can't make any promises about price or returns: most memecoins lose value. I can only help you set the launch up.", proof: proof(12) },
      { at: m(154), who: 'caller', text: 'One hour, soft cap 100 NEAR, 5% team with a week cliff, vest over a month. Yes, launch it.' },
      { at: m(154.3), who: 'agent', text: 'Done. The launch link is on its way; check it and sign with your own wallet.', proof: proof(13) },
    ],
  },
];

const { icon } = await drawLogo('ZZZ');
const launches = [
  { id: 'l1', callId: 'c4', createdAt: m(154.3), network: 'mainnet', status: 'prepared', logoModel: 'drawn locally',
    params: { name: 'Sleepy Otter', symbol: 'ZZZ', description: 'An otter that naps through every dip.', icon, socials: {} } },
];

const ledger = [
  { at: m(151.1), kind: 'refused', desk: 'launch', callId: 'c4', detail: 'set_coin: NEAR is the ticker of an existing asset; launching it would look like impersonation.' },
  { at: m(152.5), kind: 'filtered', desk: 'launch', callId: 'c4', detail: 'reply said "100x"; replaced before it was spoken' },
  { at: m(153), kind: 'logo', desk: 'launch', callId: 'c4', detail: 'ZZZ: drawn locally' },
  { at: m(154.3), kind: 'launch_prepared', desk: 'launch', callId: 'c4', launchId: 'l1', detail: '$ZZZ Sleepy Otter, 60 min, soft cap 100 NEAR on testnet' },
];

mkdirSync(FILE.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(FILE, JSON.stringify({ calls, launches, ledger }, null, 1));
console.log(`demo data written to ${FILE}`);
