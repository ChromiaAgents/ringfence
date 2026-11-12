// Crypto glossary and a context-gated corrector for speech-to-text output.
// Whisper hears "NEAR" as "near", "Nier", "nir"; "SOL" as "Seoul"; "ZEC" as "Zach". We map a misheard word to the
// closest glossary term by spelling and sound, but only where the sentence makes it a crypto word (an amount,
// "top up with", "pay with", "tokens", ...), so "pass the salt" or "Neo is a film" stay as they are.

/** Tickers we always know, with spoken names and common mishearings. The live 1Click list adds more symbols. */
const FIXED: Record<string, string[]> = {
  NEAR: ['near', 'nier', 'nir', 'nia', 'nair', 'neer', 'nea', 'neo', 'nearer'],
  wNEAR: ['wnear', 'wnir', 'wnier', 'wnia', 'wneo', 'wrapped near'],
  stNEAR: ['stnear', 'stnir', 'stnier', 'st near', 'st nir', 'staked near'],
  USDC: ['usdc', 'lsdc', 'lxdc', 'osdc', 'usd see'], USDT: ['usdt', 'tether'],
  SOL: ['sol', 'solana', 'seoul', 'salt', 'soul', 'sole', 'solo'], ETH: ['eth', 'ether', 'ethereum'],
  BTC: ['btc', 'bitcoin'], DOGE: ['doge', 'dogecoin'], ADA: ['ada', 'cardano'], AVAX: ['avax', 'avix', 'avalanche'],
  BNB: ['bnb'], LINK: ['link', 'chainlink'], UNI: ['uni', 'uniswap'], ARB: ['arb', 'arm', 'arbitrum'], OP: ['op', 'optimism'],
  SUI: ['sui', 'suey', 'sway'], PEPE: ['pepe', 'pipay', 'pepay'], SHIB: ['shib', 'shig', 'shame', 'shiba'],
  TRUMP: ['trump'], ZEC: ['zec', 'zach', 'zack', 'zek', 'zeg', 'zik', 'zeck', 'zcash'], TRX: ['trx', 'tron'],
  DAI: ['dai', 'dye', 'die'], APT: ['apt', 'aptos'], SWEAT: ['sweat', 'swe'], LTC: ['ltc', 'litecoin'],
  XRP: ['xrp', 'ripple'], AURORA: ['aurora'], RHEA: ['rhea'], HOT: ['hot'],
};
/** Ordinary English words: only fixed with a strong cue (an amount, top up/pay with, or "tokens/coins" after). */
const COMMON = new Set(['near', 'rhea', 'salt', 'soul', 'sole', 'solo', 'link', 'uni', 'arm', 'shame', 'trump', 'die', 'dye', 'sweat', 'hot', 'aurora', 'zach', 'zack', 'sway', 'op', 'apt', 'seoul', 'neo', 'nearer', 'ada', 'tron', 'ripple', 'avalanche', 'optimism', 'cardano', 'bitcoin', 'ether', 'ethereum', 'solana', 'litecoin']);
/** Names that stay as names (a chain or project said in full), never turned into a ticker. */
const KEEP = new Set(['solana', 'ethereum', 'bitcoin', 'cardano', 'avalanche', 'optimism', 'arbitrum', 'tron', 'aptos', 'litecoin', 'chainlink', 'uniswap', 'ripple', 'zcash', 'tether', 'dogecoin', 'shiba', 'ether']);

/** App accounts that callers say aloud. Misheard names within one edit are snapped to these. */
export const ACCOUNTS = ['liho00.near', 'mum.near', 'stranger.near', 'ringfence-family.sputnik-dao.near'];

let live: string[] = [];
/** Feed the live 1Click symbols in (cached by fund.listTokens); the fixed list still works offline. */
export function setLiveSymbols(symbols: string[]) {
  live = [...new Set(symbols.map((s) => String(s)).filter((s) => /^[A-Za-z][A-Za-z0-9]{1,9}$/.test(s)))];
}

type Entry = { sym: string; alias: string; live?: boolean };
function glossary(): Entry[] {
  const out: Entry[] = [];
  for (const [sym, al] of Object.entries(FIXED)) for (const a of al) out.push({ sym, alias: a });
  for (const s of live) if (!out.some((e) => e.sym.toLowerCase() === s.toLowerCase())) out.push({ sym: s, alias: s.toLowerCase(), live: true });
  return out;
}
export const symbols = () => [...new Set(glossary().map((e) => e.sym))];

export function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
/** A rough sound key: same-sounding consonants merged, vowels after the first letter dropped. */
export function sound(w: string): string {
  const s = w.toLowerCase().replace(/[^a-z]/g, '').replace(/ph/g, 'f').replace(/ck|q|c|g/g, 'k').replace(/z/g, 's').replace(/[wh]/g, '');
  return (s[0] ?? '') + s.slice(1).replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
}

/** Closest glossary symbol to a spoken or misheard word, or null. Exact alias first, then one edit, then sound. */
export function closest(word: string): { sym: string; exact: boolean; live?: boolean } | null {
  const w = word.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!w) return null;
  const all = glossary(), g = all.filter((e) => !e.live);
  const hit = all.find((e) => e.alias === w || e.sym.toLowerCase() === w);
    if (hit) return { sym: hit.sym, exact: !hit.live || false, live: hit.live };
  if (w.length >= 4) {
    const near = g.filter((e) => e.alias.length >= 4 && lev(e.alias, w) === 1);
    if (new Set(near.map((e) => e.sym)).size === 1) return { sym: near[0].sym, exact: false };
  }
  if (w.length >= 3) {
    const k = sound(w);
    const same = g.filter((e) => e.alias.length >= 3 && k.length >= 2 && sound(e.alias) === k);
    if (new Set(same.map((e) => e.sym)).size === 1) return { sym: same[0].sym, exact: false };
  }
  return null;
}

const NUM = String.raw`(?:\d[\d.,]*|one|two|three|four|five|six|seven|eight|nine|ten|half an?|a quarter of an?|quarter of an?)`;
const WORDNUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const STRONG_BEFORE = /(?:\d[\d.,]*|\$\d[\d.,]*|dollars?|bucks|worth|top(?:ped)? up|topup|pay|paid|swap|sell|buy|deposit|convert)\b(?:\s+\w+){0,2}\s*$/i;
const WEAK_BEFORE = /\b(?:with|of|off|in|into|hold|have|has|some|my|use|using)\s*$/i;
const STRONG_AFTER = /^\s*(?:tokens?|coins?|worth|on (?:near|solana|ethereum|base|tron|cardano|avalanche|arbitrum|optimism|aptos))\b/i;
const TIGHT_BEFORE = /(?:\d[\d.,]*|\$\d[\d.,]*|dollars?|bucks|worth|of|off|with|using|use|into|in|swap|buy|sell|top(?:ped)? up|topup)\s*$/i;
const NEAR_VARIANTS = 'near|nier|nir|nia|nair|neer|nea|nearer|ner';

/** Fix crypto names in a transcript. Safe to run twice. */
export function correct(input: string): string {
  let t = String(input ?? '');
  if (!t) return t;

  // ---- Accounts: "liho zero zero dot near", "stranger dot nir", "LIHO00.NEAR", "stranger.near1near".
  t = t.replace(/\b([a-z][a-z0-9-]*)\s+(\d+)\.(?=(?:near|nir|nier|nia|ner)\b)/gi, '$1$2.');
  t = t.replace(/\b([a-z][a-z0-9-]*)((?:\s+(?:zero|oh|one|two|three))*)\s+dot\s+(?:near|nir|nier|nia|ner)\b/gi, (_m, name: string, digits: string) => {
    const d = digits.trim() ? digits.trim().split(/\s+/).map((x) => ({ zero: '0', oh: '0', one: '1', two: '2', three: '3' } as Record<string, string>)[x.toLowerCase()]).join('') : '';
    return `${name.toLowerCase()}${d}.near`;
  });
  t = t.replace(/\b([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)\.(?:near|nier|nir|nia|neo|ner|neer|nea|net)(?:-?(?:dao|dal|deo)|dao|deo)?(?:\s?(\d+)\s?(?:near|nir|nier))?\b/gi, (m, name: string, glued: string | undefined) => {
    let n = name.toLowerCase().replace(/ring(?:fans|fants|fence)-family/, 'ringfence-family').replace(/sputnik-d(?:al|eo|ay)$/, 'sputnik-dao');
    if (m.toLowerCase().endsWith('.net') && !/sputnik/.test(n)) return m; // a real .net address
    let acct = `${n}.near`;
    const snap = ACCOUNTS.find((a) => a !== acct && lev(a, acct) === 1 && acct.length >= 8);
    if (snap) acct = snap;
    const tail = /(?:dao|dal|deo)$/i.test(m.replace(/\s?\d+\s?(?:near|nir|nier)$/i, '')) && /sputnik/.test(acct) ? ' DAO' : '';
    return acct + tail + (glued ? ` ${glued} NEAR` : '');
  });

  // ---- Chinese: NEAR and USDC heard as sound-alikes next to Chinese words.
  if (/\p{Script=Han}/u.test(t)) {
    const money = /红包|紅包|发送|發送|转账|轉帳|充值|余额|餘額|鱼鹅|USDC|钱包|錢包/.test(t);
    t = t.replace(/(?<=[\p{Script=Han}]|^)\s*(?:NIR|NR|Near|near|Lair|N1A2)\s*(?=[\p{Script=Han}\p{P}]|$)/gu, 'NEAR');
    t = t.replace(/(?<=[\p{Script=Han}\s])(?:LXDC|LSDC|OSDC|USDC)\s*(?=[\p{Script=Han}\p{P}]|$)/gu, 'USDC');
    t = t.replace(/鱼鹅|魚鵝/g, '余额');
    if (money) t = t.replace(/(?<=个|個|有多少)(?:妮儿|女儿|女兒|热儿|熱兒|乐儿|樂兒|恩恩|Lair)/gu, 'NEAR');
    t = t.replace(/恩尔|恩爾/g, 'NEAR');
  }

  // ---- NEAR phrases.
  t = t.replace(/\b(?:near|nier|nir)\s+intents?\b/gi, 'NEAR Intents')
    .replace(/\b(?:near|nier|nir)\s+(?:AI|A\.I\.)(?=\s|[.,?!]|$)/gi, 'NEAR AI')
    .replace(/\bmy\s*(?:near|nia|nir|nier)\s*wallet\b/gi, 'MyNearWallet')
    .replace(/\bmedia wallet\b/gi, 'meteor wallet')
    .replace(/\b(connect|use|open|my) hot wallet\b/gi, '$1 HOT wallet')
    .replace(/\b(?:us\s+)?(?:S?putnik)\s+(?:DAO|Deo|Dao|day herb|dal|day)\b/gi, (m) => (/^us\s/i.test(m) ? 'us Sputnik DAO' : 'Sputnik DAO'))
    .replace(/\bjust\s+hoot\b/gi, 'JustHoot')
    .replace(/\b(?:REIA|Rea|Rio|Turia|Ria)\s*Finance\b/g, 'rhea finance')
    .replace(/\blocky split\b/gi, 'lucky split')
    .replace(/\bMyPin\b/g, 'my PIN')
    .replace(/\b(\d+)x RP\b/g, '$1 XRP')
    .replace(/\binterest in ear\b/gi, 'into stNEAR')
    .replace(/\b(?:w|double[ -]?u|dub)[ -]?(?:near|neo|nea|neer|nier|nir|nia|kneel)\b/gi, 'wNEAR')
    .replace(/\bst[ -]?(?:near|nir|nier)\b/gi, 'stNEAR')
    .replace(/\b(?:u[ .]?s[ .]?d[ .]?c|you s d c|usd see)\b/gi, 'USDC')
    .replace(/\b(?:u[ .]?s[ .]?d[ .]?t)\b/gi, 'USDT')
    .replace(/\b(?:e[ .]t[ .]h|eath)\b/gi, 'ETH');
  // An amount of NEAR: "0.1 nir", "one near", "half an ear", "a quarter of an ear", "send to near to mum.near".
  t = t.replace(new RegExp(String.raw`\b(${NUM})\s*(?:${NEAR_VARIANTS}|neo|nayr)\b(?!\s+(?:the|a|an|here|there|by|me|us|you|my|our|your|his|her|him|them|it)\b)`, 'gi'), (_m, n: string) => `${WORDNUM[n.toLowerCase()] ?? n.replace(/\ban\b/i, 'a')} NEAR`)
    .replace(/\b(send|give|pay|sent|with)(\s+a)?\s+(half|quarter of) an ear\b/gi, '$1$2 $3 a NEAR')
    .replace(/\b(send|give|pay) (?:to|two) (?:near|nir|nier)(?= to\b)/gi, '$1 2 NEAR');
  // "worth of nier", "into Nier", "and NIR": a NEAR mishearing that is not an English word, after a money cue.
  t = t.replace(/\b(worth of|into|of|and|with|in|some|my|have)\s+(near|nier|nir|nia|nair|neer)\b(?!\s*(?:the|a|an|here|by|to me|future)\b)/gi, (m, pre: string, w: string) =>
    (w.toLowerCase() === 'near' && !/worth of|into/i.test(pre)) ? m : `${pre} NEAR`);

  // ---- Tickers by sound, only in a crypto context.
  t = t.replace(/(?<![\w.$-])([A-Za-z][A-Za-z']{1,9})(?![\w.-]*\.near)\b/g, (m: string, w: string, off: number, all: string) => {
    const lw = w.toLowerCase();
    if (KEEP.has(lw) || /^(?:a|an|the|to|of|in|on|and|or|is|it|my|i|me|we|you|up|top|pay|use|with|send|from|for|can|this|that|half|one|two|worth|some|have|hold|into|please|tokens?|coins?|dollars?|cash|card|cards|money|change|gold|silver|points?|credit|debit|bank|cheque|check|paypal|apple|google|venmo|crypto|stablecoins?)$/.test(lw)) return m;
    const c = closest(lw);
    if (!c || c.sym === m) return m;
    if (/NEAR$/.test(c.sym) && c.sym === 'NEAR') return m; // NEAR handled above, with its own rules
    const before = all.slice(Math.max(0, off - 40), off), after = all.slice(off + m.length, off + m.length + 30);
    const strong = STRONG_BEFORE.test(before) || STRONG_AFTER.test(after);
    const weak = WEAK_BEFORE.test(before);
    if (c.live && !strong) return m;
    // A one-edit or sound-alike match needs the cue right next to it ("of", "with", an amount), so "pay me back",
    // "4 dollars for lunch" or "5 dollars to Rhea" are not read as ZEC, LINK or RHEA. Ordinary words get the same rule.
    if ((!c.exact || COMMON.has(lw)) && !(TIGHT_BEFORE.test(before) || STRONG_AFTER.test(after))) return m;
    const common = COMMON.has(lw) || !c.exact;
    if (strong || (weak && !common)) {
      if (lw === 'link' && /chainlink\s*$/i.test(before)) return 'LINK';
      return c.sym;
    }
    return m;
  });
  return t;
}
