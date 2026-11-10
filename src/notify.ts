// One way to reach a phone outside a call: a WhatsApp text. Set by src/whatsapp.ts when a token is configured;
// without it (tests, keyless runs) nothing is sent.
let send: ((phone: string, text: string) => void) | undefined;
export const setNotifier = (f: typeof send) => (send = f);
export const notify = (phone: string | undefined, text: string) => { if (phone) send?.(phone, text); };
