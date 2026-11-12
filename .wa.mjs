import WebSocket from 'ws';
const list = await (await fetch('http://127.0.0.1:9350/json/list')).json();
const t = list.find((x) => x.type === 'page' && x.url.includes('web.whatsapp.com'));
const ws = new WebSocket(t.webSocketDebuggerUrl); let id = 0; const pend = {};
const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pend[i] = ok; ws.send(JSON.stringify({ id: i, method, params })); });
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend[m.id]) pend[m.id](m.result); });
await new Promise((r) => ws.on('open', r));
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const mode = process.argv[2];
if (mode === 'open') {
  await send('Page.navigate', { url: 'https://web.whatsapp.com/send?phone=15551444220&text=' + encodeURIComponent(process.argv[3] ?? '') });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1000)); const ok = await ev(`!!document.querySelector('#main footer [contenteditable="true"]')`); if (ok) { console.log('chat open'); break; } }
} else if (mode === 'send') {
  const ok = await ev(`(() => { const b = document.querySelector('#main footer [data-icon="send"], #main footer button[aria-label="Send"]'); if (b) { (b.closest('button') || b).click(); return true } return false })()`);
  console.log('sent', ok);
} else if (mode === 'read') {
  const msgs = await ev(`[...document.querySelectorAll('#main [data-pre-plain-text], #main .message-in, #main .message-out')].slice(-12).map(e => (e.classList.contains('message-out') ? 'ME: ' : e.classList.contains('message-in') ? 'RF: ' : '') + (e.innerText || '').replace(/\\n+/g, ' ').slice(0, 220))`);
  const head = await ev(`(document.querySelector('#main header')?.innerText || '').slice(0, 80)`);
  console.log('chat:', head); for (const m of msgs || []) console.log(m);
}
ws.close();
