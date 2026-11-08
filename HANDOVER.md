# callhand: deployment handover

For Johnson. Tan sends you the `.env` separately (by DM). Nothing secret is in this repo.

Repo: https://github.com/ChromiaAgents/callhand (private, branch `main`).

## What it is

A phone agent for the NEAR hackathon (deadline 14 Nov 2026, 23:59 UTC). People call or message one WhatsApp number, or call from the browser. The first thing they say picks a desk:

- **Launch desk.** It talks them through a memecoin. At the end it sends a link where they sign the launch on meme.cooking with their own NEAR wallet. The server never holds keys or funds.
- **Business desk.** A sample builder. It quotes jobs from a description or a photo, books a visit, and takes a deposit in any token through NEAR Intents.
- **Owner desk.** The owner's number can say "owner ..." to change the business rules by voice, inside hard limits.

## How it runs

One Node process (`server.ts`) on one port (default `8787`) serves all of it:

- the web UI (TanStack Start, built into `dist/`);
- the browser voice WebSocket;
- the WhatsApp webhook at `/webhooks/whatsapp`;
- the WhatsApp call media (WebRTC through `werift`: ICE, DTLS-SRTP, Opus).

Work runs in four places:

| Job | Where |
| --- | --- |
| Chat model, speech-to-text, photo reading, logo drawing | NEAR AI Cloud (`cloud-api.near.ai`): Qwen3.6-35B, Whisper large v3, Qwen3-VL, FLUX.2 klein. Every reply's TEE signature is checked in the background. |
| Text-to-speech | Local. Kokoro 82M runs in a worker thread (`src/tts-worker.ts`), voice `af_heart` at 1.15× speed. |
| Deposits | NEAR Intents 1Click, mainnet only. It only quotes and returns a deposit address; no money moves unless a customer pays. |
| Coin launches | meme.cooking contract `factory.v10.meme-cooking.testnet`. The user signs it in their own wallet. |

State is one JSON file, `data/db.json`, plus customer photos in `data/photos/`. Keep `data/` on a persistent disk.

## What the host needs

- **Node 22 or newer.** `npm start` runs through `tsx`, so the source is TypeScript and there's no separate compile step.
- **A public HTTPS URL** pointing at the port. Meta's webhook and the launch and deposit links use it. Set it as `PUBLIC_URL`.
- **Inbound UDP for WhatsApp call audio.** werift uses random ports and finds its public address through Google's STUN server. It worked from Tan's Mac behind home NAT. On a cloud VM, either open the UDP range or give the box a public IP.
  - This is why **Vercel won't work**: it has no long-running process, no UDP, and Kokoro would cold-start every time.
  - Render-style hosts that only take HTTP are out for calls too. Messages and the browser call would still work there.
- **CPU.** Kokoro takes about 0.7–1.7 s per sentence on a laptop CPU. That's most of the remaining delay before the agent speaks. A GPU would cut it a lot (see "Later" below).
- **Internet on first boot.** Kokoro's weights (about 90 MB) download from Hugging Face. The first start takes longer; after that, about 5 s to warm up.

## Deploy steps

```bash
git clone git@github.com:ChromiaAgents/callhand.git && cd callhand
npm ci
cp /path/from/tan/.env .env        # then edit PUBLIC_URL, see below
npm run typecheck && npm test      # expect "14 passed"
npm run build
npm start                          # logs "voice ready" and "attested ..." when warm
```

To give it a stable public URL, a Cloudflare named tunnel is easiest. Tan has been using a quick `trycloudflare.com` tunnel, which changes its URL on every restart:

```bash
cloudflared tunnel login
cloudflared tunnel create callhand
cloudflared tunnel route dns callhand callhand.<your-domain>
cloudflared tunnel run --url http://localhost:8787 callhand
```

A reverse proxy works too (for example Caddy: `callhand.example.com { reverse_proxy localhost:8787 }`). WebSockets must pass through.

To keep it running, a systemd unit:

```ini
[Unit]
Description=callhand
After=network-online.target

[Service]
WorkingDirectory=/opt/callhand
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

After deploying, check it from outside:

```bash
curl "https://<host>/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=ok"
# expect: ok
```

## Meta / WhatsApp

Already done, nothing to repeat:

- The Meta app `callhand` (App ID 2035723743782241) sits in the "Callhand" business portfolio.
- The test number is +1 555 144 4220 (phone number ID 1441115005751835, WhatsApp Business account 1312482557640262).
- Calling is enabled on the number through the API (`POST /{phone-id}/settings`, `calling.status = ENABLED`).
- The app is subscribed to the WhatsApp Business account (`POST /{waba-id}/subscribed_apps`).

You need to do:

1. **Point the webhook at your host.** developers.facebook.com → callhand → Use cases → Customize → Webhooks. Set the callback URL to `https://<host>/webhooks/whatsapp`, use the verify token from `.env`, then verify and save. The `messages` and `calls` fields must be subscribed.
2. **Replace the access token.** The `WHATSAPP_TOKEN` in `.env` is a temporary one that expires within 24 hours. Make a permanent one:
   1. Business settings → System users → add an admin system user.
   2. Assign it the `callhand` app and the WhatsApp account (full control).
   3. Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
   4. Put the new token in `.env` and restart.
3. **Allowed recipients.** The test number can only message numbers added under "To" on the app's Try it out page, and only up to 5 of them. Inbound calls from any WhatsApp user are fine. For a real number with a "Callhand" display name, add your own number in Production setup. Meta reviews the name.

## Environment variables

Tan's `.env` already has these filled in:

| Variable | Notes |
| --- | --- |
| `NEARAI_API_KEY` | NEAR AI Cloud. Spends credits: a logo is about $0.012, chat and speech cost cents. |
| `NETWORK` | `testnet`. Switching to `mainnet` means real launches with real NEAR. Don't switch without Tan. |
| `PUBLIC_URL` | **Change this** to your host's URL. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | The token needs replacing (see above). The app secret checks webhook signatures; requests that don't match get 401. |
| `OWNER_WHATSAPP` | Tan's number. It reaches the owner desk with "owner ...". |
| `OWNER_NEAR_ACCOUNT` | The mainnet account that receives deposits. |
| `DASHBOARD_PASSWORD` | Basic auth for `/dashboard`, `/api/state` and `/api/owner`. |

These are optional and empty on purpose:

- `PINATA_JWT`: skipped. Coin descriptions show on our launch page instead.
- `ONECLICK_JWT`: without it, 1Click adds a 0.2% fee.
- Tuning: `TTS_VOICE` (default `af_heart`), `TTS_SPEED` (`1.15`), `FILLER_MS`, and `LLM_MODEL` / `STT_MODEL` / `VISION_MODEL` / `IMAGE_MODEL`.
- Offline timing without keys: `MOCK_LLM=1`.

## Where things are in the code

| Path | What |
| --- | --- |
| `server.ts` | HTTP server and warm-up. It loads Kokoro and the fillers and fetches the attestations at boot. |
| `src/agent.ts` | Desk router, voice persona, streamed tool loop, filler and goodbye handling. |
| `src/desks/{launch,business,owner}.ts` | Each desk's prompt and tools. The rules are enforced here in code. |
| `src/memory.ts` | Caller memory by phone number: a recap of earlier calls, and an unfinished coin draft resumes. |
| `src/whatsapp.ts` | Webhook, message handling, WebRTC calls, turn detection, interrupting, hang-up. |
| `src/voice.ts`, `app/call.ts` | The browser call. |
| `src/ai.ts` | NEAR AI streaming chat, attestation and signature checks, speech-to-text. |
| `src/tts.ts`, `src/tts-worker.ts` | Kokoro in a worker thread; strips emoji and markdown before speaking. |
| `src/pay.ts`, `src/memecook.ts`, `src/justhoot.ts` | 1Click quotes and status; meme.cooking and JustHoot transaction building. |
| `owner.yaml`, `launchpad.yaml` | Business rules and launch rules. They're re-read on every call, so no restart is needed. |

## JustHoot

The launch desk also prepares JustHoot launches (`v2-launchpad.justhoot.near`): an instant launch whose token and RHEA pool are created in one call. It is **mainnet only and costs real NEAR** (about 0.06 to 0.1 NEAR) whatever `NETWORK` says; the launch page says so before the sign button. Switch it off with `launchpads.justhoot.enabled: false` in `launchpad.yaml`. `npm run test:justhoot` reads the live deposit and gas (views only). No real JustHoot launch has been signed yet, and reading the token id from the launch logs is untested. After a launch the page links NEARON's docs; NEARON is a testnet staging prototype.

## Logs to watch

The server logs to stdout:

- `wa heard (N ms): "..."`: what speech-to-text heard.
- `[turn ...] stt / first token / first audio / total`: per-turn timing. The dashboard shows the same.
- `wa ice connected`, `wa candidates ...`: whether the call's audio connection opened. If a call rings and nobody answers, ICE didn't connect. Check UDP.
- `wa rx ...: no audio from caller`: the call is up, but no audio is coming in.

## Known issues

- **Delay:** about 3–5 s before the agent starts speaking on WhatsApp. Whisper on NEAR AI takes about 1.8 s of that; Kokoro on CPU takes most of the rest.
- **Talking over the agent** hasn't been tuned on a real phone. Echo from a speakerphone can cut the agent off.
- **Unfinished coin drafts** live in memory, so a restart forgets them. Finished launches and quotes are saved.
- **The NEAR AI signature check on streamed replies** follows NEAR's docs but hasn't been checked against a live signature yet.
- **Only the launch page's wallet button has been checked** in headless Chrome. No real testnet launch has been signed yet; Tan does that with their own testnet wallet.

## Later: GPU voice on the DGX Spark

`src/tts.ts` is the only place that changes. Point `speak()` at an HTTP TTS server on the Spark, for example Kokoro on GPU, Orpheus or Chatterbox, which sound more natural. Return 24 kHz mono PCM. Two trade-offs to keep in mind:

- **Privacy pitch:** a remote TTS server sees the reply text. The pitch is "models in TEEs, nobody in the middle", so say this in the write-up, or keep TTS on the same box as the server.
- **Distance:** network round-trip adds about 50–250 ms. Still much faster than CPU Kokoro.

## Rules for this project

- Ask Tan before making the repo public, posting anything, submitting to the hackathon, or switching to mainnet.
- Never commit `.env` or `data/`; both are gitignored.
