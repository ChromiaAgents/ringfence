// Turns streamed model text into speakable sentences: drops <think> blocks, cuts at sentence ends,
// and runs the desk's output filter on each sentence before anyone hears it.

/** Feed text deltas in; get whole sentences out. flush() returns what is left at the end. */
export function sentenceSplitter(filter?: (s: string) => { text: string; hit?: string }, onHit?: (hit: string, said: string) => void) {
  let buf = '';
  let first = true;
  let prev = '';
  let blocked = false; // after a filtered sentence, the rest of the reply is dropped (the replacement says it all)
  const clean = (s: string) => {
    if (blocked) return null;
    const t = s.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    // check this piece together with the one before, so a claim cut in half at a comma is still caught
    const f = filter?.(`${prev} ${t}`.trim());
    if (f?.hit) { blocked = true; onHit?.(f.hit, t); return f.text; }
    prev = t;
    return t;
  };
  const take = (final: boolean) => {
    // strip finished think blocks; hold everything while one is still open
    buf = buf.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*<\/think>/, '');
    const open = buf.indexOf('<think>');
    const head = open >= 0 ? buf.slice(0, open) : buf;
    const out: string[] = [];
    // a sentence ends at . ! ? followed by space (so 2.5 and URLs stay whole). A long clause may also end at a comma
    // (25+ chars for the first piece, 45+ later), so the first audio starts sooner and long sentences don't stall.
    const re = /[.!?…]+["')\]]*\s+|,\s+/g;
    let m: RegExpExecArray | null, from = 0;
    while ((m = re.exec(head))) {
      const end = m.index + m[0].length;
      if (end - from < (m[0][0] !== ',' ? 7 : first ? 25 : 45)) continue; // "Mr." alone or a short clause: keep going
      first = false;
      out.push(head.slice(from, end)); from = end;
    }
    let rest = head.slice(from) + (open >= 0 ? buf.slice(open) : '');
    if (final) { if (open < 0) out.push(rest); rest = ''; }
    buf = rest;
    return out.map(clean).filter((x): x is string => !!x);
  };
  return {
    push: (delta: string) => { buf += delta; return take(false); },
    flush: () => take(true),
  };
}
