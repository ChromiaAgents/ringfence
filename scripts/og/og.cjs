// Renders one 1200x630 share card per page into public/og/<slug>.png, with the site's own fonts and real screenshots
// from the demo recordings. Run: node scripts/og/og.cjs  (needs Chrome and playwright; the server only serves the PNGs).
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '../..');
const pub = (p) => 'file://' + path.join(root, 'public', p);

// slug: [kicker, headline, line, picture (public path) or null, side panel lines when there is no picture]
const CARDS = {
  home: ['NEAR mainnet', 'A phone call is the wallet.', 'Pay, send money packets, top up and launch a coin by voice. A NEAR contract caps what the AI can spend.', 'demo/room.jpg'],
  room: ['Live room', 'Gift her real NEAR by phone call.', 'Tap the mic, say the words, open a share of the money packet. The AI host thanks every gift out loud.', 'demo/gift.jpg'],
  packet: ['Money packet 🧧', 'Say the words. Get a share.', 'One pot of NEAR split between a group, opened on a phone call. Lucky or equal shares, on mainnet.', 'demo/packet.jpg'],
  topup: ['NEAR Intents', 'Top up from any chain, by asking.', '1 USDT on Solana became 0.9996 USDC in a phone wallet. USDT, USDC, SOL, ETH, BTC.', 'demo/topup.jpg'],
  launch: ['JustHoot', 'Launch a coin by voice.', 'Name, ticker and logo on the call. You sign it in your own NEAR wallet; it trades on RHEA at once.', 'demo/launch.jpg'],
  proof: ['Private AI', 'Checked live, in a TEE.', 'Chat, speech-to-text and logo models on NEAR AI Cloud. Intel TDX and NVIDIA attestation, fresh nonce.', 'demo/proof.jpg'],
  wallets: ['Live balances', 'Every wallet, in the open.', 'The demo phone wallet, the room host, the packets contract and the AI key, read from NEAR every 15 s.', null,
    ['Demo phone wallet', 'Room host', 'Packets contract', 'AI agent key', 'Wallet factory', 'Custody']],
  stats: ['The line, in numbers', 'Every call. Every no.', 'Calls answered, packets opened by voice, sends on mainnet and every time the contract refused.', null,
    ['Calls answered', 'Packets opened', 'Sends on mainnet', 'No: over a limit', 'No: wrong PIN', 'No: wrong words']],
  whatsapp: ['WhatsApp', 'Call her on WhatsApp.', 'Say what you want: send NEAR, a money packet, a top up or a coin. The contract keeps the AI inside its limits.', 'demo/room.jpg'],
  bind: ['Own it', 'Your number, your NEAR wallet.', 'Link your phone number to your own NEAR account and set the limits the AI must stay inside.', null,
    ['Per-send limit', 'Per-day limit', 'Saved recipients', '60 s hold', 'Freeze', 'Revoke the AI']],
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = ([kicker, head, line, pic, list]) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Battlefin; src: url(${pub('fonts/battlefin-black.woff2')}); }
@font-face { font-family: Geist; src: url(${pub('fonts/geist-latin.woff2')}); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: #0c0a08; color: #f4f3f1; font-family: Geist, sans-serif; display: flex; overflow: hidden; }
.l { flex: 1; padding: 64px 0 56px 72px; display: flex; flex-direction: column; }
.k { font-size: 26px; font-weight: 600; color: #00ec97; display: flex; align-items: center; gap: 14px; }
.k img { height: 30px; }
h1 { font: 400 76px/1.02 Battlefin; margin-top: 30px; max-width: 13ch; }
p { margin-top: 26px; font-size: 28px; line-height: 1.35; color: #b8b2a8; max-width: 30ch; }
.f { margin-top: auto; display: flex; align-items: center; gap: 18px; font-size: 24px; color: #b8b2a8; }
.f b { font: 400 34px/1 Battlefin; color: #f4f3f1; }
.fence { position: absolute; left: 72px; bottom: 0; width: 330px; height: 10px; background: #00ec97; }
.r { width: 430px; position: relative; display: flex; align-items: center; justify-content: center; }
.ph { width: 300px; height: 560px; border-radius: 34px; overflow: hidden; border: 8px solid #181512; box-shadow: 0 0 0 2px #2a2520; }
.ph img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.list { margin-right: 64px; width: 360px; background: #181512; padding: 26px 30px; }
.list div { font-size: 25px; padding: 15px 0; border-bottom: 2px solid #2a2520; display: flex; gap: 16px; align-items: center; }
.list div:last-child { border: 0; }
.list i { width: 14px; height: 14px; background: #00ec97; flex: none; }
</style></head><body>
<div class="l"><div class="k"><img src="${pub('brand/near-mark-light.svg')}">${esc(kicker)}</div>
<h1>${esc(head)}</h1><p>${esc(line)}</p>
<div class="f"><b>Ringfence</b> ringfence.evalengine.ai</div></div>
<div class="r">${pic ? `<div class="ph"><img src="${pub(pic)}"></div>` : `<div class="list">${list.map((x) => `<div><i></i>${esc(x)}</div>`).join('')}</div>`}</div>
<div class="fence"></div></body></html>`;

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  for (const [slug, c] of Object.entries(CARDS)) {
    const f = require('os').tmpdir() + `/og-${slug}.html`;
    require('fs').writeFileSync(f, html(c));
    await p.goto('file://' + f, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(root, 'public/og', `${slug}.png`) });
    console.log('og/' + slug + '.png');
  }
  await b.close();
})();
