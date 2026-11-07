// Writes a demo database for screenshots and UI work. Never committed (data/ is git-ignored).
// Usage: npm run seed            -> data/demo-db.json
//        DB_FILE=data/demo-db.json npm run dev
import { writeFileSync, mkdirSync } from 'node:fs';

const FILE = process.env.SEED_FILE ?? 'data/demo-db.json';
const t0 = Date.now() - 3 * 3600_000;
const m = (min: number) => t0 + min * 60_000;
const proof = (n: number) => ({ chatId: `demo-${n}`, model: 'Qwen/Qwen3.6-35B-A3B-FP8', requestHash: '0x', responseHash: '0x', status: 'verified', signer: '0x0000000000000000000000000000000000000000', kind: 'ecdsa' });

const calls = [
  {
    id: 'c1', channel: 'web', startedAt: m(0), endedAt: m(4), jobId: 'j1', caller: { name: 'Sam', postcode: 'E8 3QP' },
    turns: [
      { at: m(0), who: 'agent', text: "Hi, you've reached Hart & Sons Builders, this is the booking assistant. How can I help?" },
      { at: m(0.3), who: 'caller', text: 'Hi, I need a new kitchen.' },
      { at: m(0.4), who: 'agent', text: 'Happy to help. Roughly what size is the room, and what is in there now?', proof: proof(1) },
      { at: m(1), who: 'caller', text: "Medium size, white units, oak worktop." },
      { at: m(1.1), who: 'agent', text: 'Lovely. Could I take your name and postcode?', proof: proof(2) },
      { at: m(1.5), who: 'caller', text: "I'm Sam, postcode E8 3QP." },
      { at: m(1.7), who: 'agent', text: 'Thanks Sam. A medium kitchen fitting comes to about $8,250, confirmed at the site visit.', proof: proof(3) },
      { at: m(2), who: 'caller', text: 'Can you do 30% off?' },
      { at: m(2.2), who: 'agent', text: "I can't go that far, the most I can offer is 10%, which makes it $7,425.", proof: proof(4) },
      { at: m(2.8), who: 'caller', text: 'OK, book it for next Tuesday.' },
      { at: m(3), who: 'agent', text: "Booked for Tuesday. James will do the site visit, and the deposit link is on its way.", proof: proof(5) },
    ],
  },
  {
    id: 'c2', channel: 'whatsapp', from: '447700900123', startedAt: m(60), endedAt: m(63), jobId: 'j2', caller: { name: 'Priya', postcode: 'N16 7XJ' },
    turns: [
      { at: m(60), who: 'agent', text: "Hi, you've reached Hart & Sons Builders, this is the booking assistant. How can I help?" },
      { at: m(60.5), who: 'caller', text: 'The bathroom tap is leaking and a tile is cracked.' },
      { at: m(60.7), who: 'agent', text: 'That sounds like a half-day repair at $180. Shall I book it?', proof: proof(6) },
      { at: m(61), who: 'caller', text: 'Yes please, Thursday morning.' },
      { at: m(61.2), who: 'agent', text: 'Done. A $50 deposit link is coming to you on WhatsApp.', proof: proof(7) },
    ],
  },
  {
    id: 'c3', channel: 'web', startedAt: m(120), endedAt: m(121), caller: { name: 'Tom', postcode: 'GU1 4AA' },
    turns: [
      { at: m(120), who: 'agent', text: "Hi, you've reached Hart & Sons Builders, this is the booking assistant. How can I help?" },
      { at: m(120.4), who: 'caller', text: 'I want a quote for an extension in Guildford.' },
      { at: m(120.6), who: 'agent', text: "We only take jobs in Greater London, but I can leave James a message.", proof: proof(8) },
    ],
  },
];

const jobs = [
  { id: 'j1', callId: 'c1', serviceId: 'kitchen', serviceName: 'Kitchen fitting', quotedUsd: 7425, discountPct: 10, depositUsd: 1485, preferredDate: 'Tuesday', notes: 'white units, oak worktop', caller: { name: 'Sam', postcode: 'E8 3QP' }, createdAt: m(3),
    payment: { quote: { depositAddress: '0x0000000000000000000000000000000000000000', amountIn: '1485000000', amountInFormatted: '1485.00', amountOutFormatted: '1485', originAsset: 'demo', dry: true }, status: 'SUCCESS', updatedAt: m(20), originSymbol: 'USDC', chain: 'base' } },
  { id: 'j2', callId: 'c2', serviceId: 'repair', serviceName: 'Small repairs (half day)', quotedUsd: 180, discountPct: 0, depositUsd: 50, preferredDate: 'Thursday morning', notes: 'leaking tap, cracked tile', caller: { name: 'Priya', postcode: 'N16 7XJ', phone: '447700900123' }, createdAt: m(61) },
];

const ledger = [
  { at: m(1.7), kind: 'quote', callId: 'c1', detail: 'Kitchen fitting medium: $8250 (0% off)' },
  { at: m(2.2), kind: 'refused', callId: 'c1', detail: 'Max discount is 10%.' },
  { at: m(2.3), kind: 'quote', callId: 'c1', detail: 'Kitchen fitting medium: $7425 (10% off)' },
  { at: m(3), kind: 'booking', jobId: 'j1', callId: 'c1', detail: 'Kitchen fitting for Sam, $7425, deposit $1485' },
  { at: m(3), kind: 'deposit_link', jobId: 'j1', callId: 'c1', detail: 'http://localhost:8787/pay/j1' },
  { at: m(20), kind: 'payment', jobId: 'j1', detail: 'SUCCESS: $1485 deposit via USDC on base' },
  { at: m(60.7), kind: 'quote', callId: 'c2', detail: 'Small repairs (half day) small: $180 (0% off)' },
  { at: m(61.2), kind: 'booking', jobId: 'j2', callId: 'c2', detail: 'Small repairs (half day) for Priya, $180, deposit $50' },
  { at: m(61.2), kind: 'deposit_link', jobId: 'j2', callId: 'c2', detail: 'http://localhost:8787/pay/j2' },
  { at: m(120.6), kind: 'message', callId: 'c3', detail: 'Tom: extension quote in Guildford, outside area' },
];

mkdirSync(FILE.replace(/\/[^/]+$/, ''), { recursive: true });
writeFileSync(FILE, JSON.stringify({ calls, jobs, ledger }, null, 1));
console.log(`demo data written to ${FILE}`);
