# callhand

An AI phone receptionist for a small building firm. A customer calls (from the browser or on WhatsApp), the agent runs the booking script, quotes inside rules the owner set in `owner.yaml`, books the site visit and sends a deposit link. The customer pays the deposit in any token on any chain through NEAR Intents 1Click. The owner receives the exact amount in USDC.

The sample business is **Hart & Sons Builders** (owner James, Greater London). It is defined in `owner.yaml` and is not a real company.

## Try it (for judges)

| Do this | You should see |
| --- | --- |
| Open `/`, press **Call** and allow the mic | The greeting is spoken and written in the live transcript within a few seconds |
| Say (or type in the box) "Hi, I need a new kitchen", then answer its questions | Short spoken replies, one question at a time |
| Ask "Can you do 30% off?" | It refuses: the `quote_job` tool returns "Max discount is 10%" before the model can agree |
| Say "OK, book it for next Tuesday" | A green **Pay the deposit** box appears under the transcript |
| Open the deposit link, pick a token, enter a refund address, press **Get deposit address** | A 1Click quote: the exact amount to send, a one-off deposit address, a QR code and a progress strip (Send, Seen, Swapping, Paid) |
| Open `/dashboard` | The call, its transcript with a **TEE-signed** badge on each verified reply, the job, the ledger (including the refused discount), the rules and the attestation of the model's signing key |
| On the landing page, type into "Try to haggle with it" | The owner's pricing rule answers live, from the same code the agent's tool calls |

No mic? Press Call anyway and type your side of the conversation.

## NEAR tech used

- **NEAR AI Cloud, private inference.** The language model (`Qwen/Qwen3.6-35B-A3B-FP8` by default) and speech-to-text (`openai/whisper-large-v3`) run in TEEs (Intel TDX + NVIDIA confidential GPUs). `src/ai.ts`:
  - fetches the model's attestation report with a fresh nonce and checks that the TDX quote's report data binds the enclave's signing address **and** our nonce;
  - fetches the signature for every chat completion and verifies (ECDSA recover) that it was signed by that attested key over the request and response hashes. The dashboard shows the result per reply.
- **NEAR Intents 1Click.** `src/pay.ts` asks 1Click for an `EXACT_OUTPUT` quote: the owner gets exactly the deposit in USDC on NEAR, the customer pays in what they hold (USDC, USDT, ETH, SOL, wNEAR, BTC, ZEC and others, on many chains). The pay page polls the deposit status until `SUCCESS`, and refunds go to the address the customer gave.

Rules are enforced in code (`src/agent.ts`, `priceFor` and the tools), not in the prompt: maximum discount, deposit percentage with a floor and a cap, the service area, and a kill switch that turns the agent into a message-taker. `owner.yaml` is re-read on every call, so changes apply without a restart.

## Run it

Requires Node 22+.

```bash
npm install
cp .env.example .env      # fill in at least NEARAI_API_KEY and OWNER_NEAR_ACCOUNT
npm run dev               # http://localhost:8787  (UI with HMR + voice + webhooks, one port)
```

Production:

```bash
npm run build
npm start
```

Other scripts: `npm run typecheck`, `npm run seed` (writes demo data to `data/demo-db.json` for UI work; run with `DB_FILE=data/demo-db.json npm run dev`), `npx tsx scripts/ws-smoke.ts ws://localhost:8787/ws/call` (checks the greeting text and audio arrive).

Both scripts load `.env` automatically when it exists.

### Environment (`.env.example`)

| Variable | What it is |
| --- | --- |
| `NEARAI_API_KEY` | NEAR AI Cloud key (cloud.near.ai, API Keys). Needed for chat and speech-to-text. The attestation check works without it. |
| `OWNER_NEAR_ACCOUNT` | Mainnet NEAR account that receives the USDC deposits |
| `PUBLIC_URL` | Public URL of this server, used in deposit links (your ngrok or cloudflared URL when testing WhatsApp) |
| `ONECLICK_JWT` | Optional 1Click partner JWT (partners.near-intents.org); without it 1Click adds a 0.2% fee |
| `DASHBOARD_PASSWORD` | Optional; protects `/dashboard` and `/api/state` with HTTP basic auth (any user name) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API, see below |
| `PORT`, `LLM_MODEL`, `STT_MODEL`, `DB_FILE`, `OWNER_FILE` | Optional overrides |

### WhatsApp setup (Meta's free test number)

1. Create an app at developers.facebook.com (type Business) and add the **WhatsApp** product. Meta gives you a public test number; add your own phone as a recipient.
2. From WhatsApp, API Setup, copy the temporary access token into `WHATSAPP_TOKEN` and the phone number ID into `WHATSAPP_PHONE_NUMBER_ID`. Copy the app secret (App settings, Basic) into `WHATSAPP_APP_SECRET`. Choose any string for `WHATSAPP_VERIFY_TOKEN`.
3. Expose the server (`cloudflared tunnel --url http://localhost:8787` or `ngrok http 8787`) and set `PUBLIC_URL` to that URL.
4. In WhatsApp, Configuration, set the callback URL to `<PUBLIC_URL>/webhooks/whatsapp` with your verify token, and subscribe to the **messages** and **calls** webhook fields.
5. Enable calling for the number: in the WhatsApp Manager, Phone numbers, your number, **Call settings**, switch **Allow voice calls** on.
6. Call or message the test number from your phone. The agent answers; when a visit is booked the deposit link arrives as a WhatsApp message.

## How it is built

- `app/` is the UI in **TanStack Start** (React, file routes): `/` (landing page with the live call), `/pay/$jobId`, `/dashboard`. HTTP APIs are Start server routes in `app/routes/api/` (`/api/state`, `/api/tokens`, `/api/price`, `/api/qr`, `/api/pay/:id`, `/api/pay/:id/quote`, `/api/pay/:id/status`) that call the modules in `src/`.
- `src/` holds the logic: `agent.ts` (script, tools, rules), `ai.ts` (NEAR AI chat, STT, attestation, signatures), `pay.ts` (1Click), `tts.ts` (local Kokoro TTS), `whatsapp.ts` (WebRTC calls with werift + Opus, messages), `store.ts` (one JSON file), `voice.ts` (the `/ws/call` socket and the webhook handler).
- `server.ts` is one Node process on one port: in dev it runs Vite in middleware mode (so Start does SSR and HMR), in prod it serves the built Start handler from `dist/`. WebSocket voice and the WhatsApp webhook need a long-lived process, so they mount on the same HTTP server. Everything is same-origin; there is no proxy.

## Honest limitations

- **No barge-in on WhatsApp:** you can't interrupt the agent while it speaks; it listens again once it has finished.
- **Attestation is partial:** the check binds the signing key and our nonce inside the TDX quote's report data, but does not verify Intel's signature on the quote or the NVIDIA GPU evidence. Use the NEAR AI Verification Center or `dcap-qvl` for the full chain.
- The browser call uses a simple energy-based voice detector and sends one WAV per sentence, so there is a short pause before each reply.
- Storage is a single JSON file (`data/db.json`), fine for a demo and a few hundred calls.
- Prices are quoted in US dollars.

## Credits

Typefaces, both SIL Open Font Licence, self-hosted from `@fontsource`: **Archivo Black** (display) and **Hanken Grotesk** (text).

Photographs on the landing page:

- "End of terrace house, Elwood Street, Highbury, London N5" by Jim Osley, CC BY-SA 2.0, via Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=105321989
- "Black Claw Hammer on Brown Wooden Plank" by Homedust, CC BY 2.0, via Flickr: https://www.flickr.com/photos/159630537@N08/28918563378
- "GOC Hampstead 107 Kenwood House (scaffolded)" by Peter O'Connor, CC BY-SA 2.0, via Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=106415915
- "Mozart Terrace, Ebury Road, London" by Oosoom, CC BY-SA 3.0, via Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=3581977

## Licence

MIT, see `LICENSE`. The photographs keep their own licences listed above.
