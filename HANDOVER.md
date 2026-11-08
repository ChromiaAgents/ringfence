# Ringfence: deployment handover

For Johnson. Tan sends you the `.env` separately (by DM). Nothing secret is in this repo.

Repo: https://github.com/ChromiaAgents/ringfence (private, branch `main`).

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
git clone git@github.com:ChromiaAgents/ringfence.git && cd ringfence
npm ci
cp /path/from/tan/.env .env        # then edit PUBLIC_URL, see below
npm run typecheck && npm test      # expect "14 passed"
npm run build
npm start                          # logs "voice ready" and "attested ..." when warm
```

To give it a stable public URL, a Cloudflare named tunnel is easiest. Tan has been using a quick `trycloudflare.com` tunnel, which changes its URL on every restart:

```bash
cloudflared tunnel login
cloudflared tunnel create Ringfence
cloudflared tunnel route dns Ringfence Ringfence.<your-domain>
cloudflared tunnel run --url http://localhost:8787 Ringfence
```

For a plain VPS (Hetzner or DigitalOcean, Singapore) there is a ready setup: `Dockerfile`, `deploy/Caddyfile`, `deploy/ringfence.service` and the steps in `deploy/README.md`.

A reverse proxy works too (for example Caddy: `ringfence.example.com { reverse_proxy localhost:8787 }`). WebSockets must pass through.

To keep it running, a systemd unit:

```ini
[Unit]
Description=ringfence
After=network-online.target

[Service]
WorkingDirectory=/opt/ringfence
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
| `NETWORK` | `testnet` or `mainnet`. Mainnet means real launches and a real-money phone wallet (Base). Don't switch without Tan. |
| `PUBLIC_URL` | **Change this** to your host's URL. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | The token needs replacing (see above). The app secret checks webhook signatures; requests that don't match get 401. |
| `OWNER_WHATSAPP` | Tan's number. It reaches the owner desk with "owner ...". |
| `OWNER_NEAR_ACCOUNT` | The mainnet account that receives deposits. |
| `DASHBOARD_PASSWORD` | Basic auth for `/dashboard`, `/api/state` and `/api/owner`. |

Phone wallet, empty until the deploy steps below are done:

| Variable | Notes |
| --- | --- |
| `AGENT_ACCOUNT_ID` | Our agent account, e.g. `ringfence-agent.near` (mainnet). Each user's contract lets it spend within limits. |
| `AGENT_PRIVATE_KEY` | `ed25519:...` key of that account. Without it the wallet desk is a labelled dry run. |
| `MPC_SIGNER` | Optional, default `v1.signer` on mainnet, `v1.signer-prod.testnet` on testnet. |
| `RPC_<chainId>`, `SEPOLIA_RPC`, `EXTRA_CHAINS` | Optional EVM RPC overrides and extra chains (`src/chains.ts`). |
| `WALLET_NEAR_PER_TX`, `WALLET_NEAR_PER_DAY`, `WALLET_EVM_PER_TX`, `WALLET_EVM_PER_DAY`, `WALLET_DELAY_SEC` | Optional: the limits the bind page proposes (defaults 1, 3, 0.0005, 0.002, 600). |

Voice and hosting:

| Variable | Notes |
| --- | --- |
| `TTS_PROVIDER` | `cartesia` (default when `CARTESIA_API_KEY` is set) or `kokoro`. Cartesia needs no 90 MB model; the reply text goes to Cartesia. |
| `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` | Cartesia Sonic; default voice "Jacqueline". `TTS_FALLBACK=kokoro` falls back to local Kokoro on errors. |
| `RTC_PORT_MIN`, `RTC_PORT_MAX` | UDP range for WhatsApp call audio, e.g. 40000 and 40100. Open it in the firewall. |

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
| `src/desks/{launch,business,owner,wallet}.ts` | Each desk's prompt and tools. The rules are enforced here in code. |
| `src/memory.ts` | Caller memory by phone number: a recap of earlier calls, and an unfinished coin draft resumes. |
| `src/whatsapp.ts` | Webhook, message handling, WebRTC calls, turn detection, interrupting, hang-up. |
| `src/voice.ts`, `app/call.ts` | The browser call. |
| `src/ai.ts` | NEAR AI streaming chat, attestation and signature checks, speech-to-text. |
| `src/tts.ts`, `src/tts-worker.ts` | Kokoro in a worker thread; strips emoji and markdown before speaking. |
| `src/pay.ts`, `src/memecook.ts`, `src/justhoot.ts` | 1Click quotes and status; meme.cooking and JustHoot transaction building. |
| `owner.yaml`, `launchpad.yaml` | Business rules and launch rules. They're re-read on every call, so no restart is needed. |

## Phone wallet (mainnet, Base as the cross-chain demo)

**Unaudited prototype: keep small amounts.** "Your phone number is a wallet": bind on `/wallet/bind`, then on a call "send 1 NEAR to bob.near" or "send 0.0001 ETH on Base to 0x…" + spoken PIN. Contract `contracts/phone-wallet` (limits per asset, EVM chain allowlist, recipient allowlist, delay queue, Chain Signatures), desk `src/desks/wallet.ts`, logic `src/wallet.ts`, EVM `src/eth.ts`, chain registry `src/chains.ts`. README "Phone wallet" has the trust model. `NETWORK` picks the network: mainnet = `v1.signer` + Base (8453); testnet = `v1.signer-prod.testnet` + Sepolia. Nothing has been deployed yet.

Mainnet defaults (proposed on the bind page, editable before signing; env `WALLET_*` changes the proposal): 1 NEAR per transfer, 3 per day; 0.0005 ETH per transfer, 0.002 per day on Base; new recipients wait 600 s. Other EVM chains (Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche) are in the server's registry but each owner must `allow_chain` them first. The EVM address is the same on every chain.

Tests: `cd contracts/phone-wallet && cargo test` (unit + local sandbox; needs Rust 1.95+, the `wasm32-unknown-unknown` target and `cargo install cargo-near`).

### Deploy to mainnet (Tan runs these; each step sends a real mainnet transaction and spends real NEAR or ETH)

Uses near-cli-rs (`cargo install near-cli-rs` or `npx near-cli-rs`). Replace `team.near` with the team's funded account, `alice.near` with the user's own account, and `<digits>` with the WhatsApp number, digits only. The wasm in `public/phone_wallet.wasm` is already built from this commit; rebuild only after contract changes.

```bash
# 0. In .env (never commit):  NETWORK=mainnet
#    (MPC_SIGNER defaults to v1.signer on mainnet; Base RPC defaults to https://mainnet.base.org, override with RPC_8453=)

# 1. The agent account, funded by the team (it only pays gas: ~0.5 NEAR is plenty), key saved in ~/.near-credentials
near account create-account fund-myself ringfence-agent.near '0.5 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as team.near network-config mainnet sign-with-keychain send
# put in .env:  AGENT_ACCOUNT_ID=ringfence-agent.near
#               AGENT_PRIVATE_KEY=<"private_key" from ~/.near-credentials/mainnet/ringfence-agent.near.json>
# then restart the server (npm start / systemctl restart ringfence)

# 2. (only after contract changes) rebuild the wasm the bind page deploys, then the app
cd contracts/phone-wallet && cargo near build non-reproducible-wasm && cp target/near/phone_wallet.wasm ../../public/ && cd ../..
npm run build

# 3. Bind (the user, with their own alice.near): open $PUBLIC_URL/wallet/bind, connect alice.near, get the WhatsApp code,
#    set a PIN, Bind, check the limits and the EVM address shown, then sign "create + fund 2.5 NEAR + deploy + init".
#    2.5 NEAR covers the contract's storage (~1.9 NEAR); step 4 adds the money it can spend.
#    If the wallet refuses a deploy action, sign it from the CLI instead (after "Bind" so the server has the PIN hash):
near account create-account fund-myself phone.alice.near '2.5 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as alice.near network-config mainnet sign-with-keychain send
near contract deploy phone.alice.near use-file public/phone_wallet.wasm with-init-call new json-args "{\"owner\":\"alice.near\",\"agent\":\"ringfence-agent.near\",\"phone_hash\":\"$(printf %s '<digits>' | shasum -a 256 | cut -d' ' -f1)\",\"signer\":\"v1.signer\",\"evm_chain_ids\":[8453]}" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-legacy-keychain send
#    (no limits in the JSON = the safe defaults above; add "near_limit":{"per_tx":"<yocto>","per_day":"<yocto>"},
#     "evm_limit":{...wei...}, "new_recipient_delay_sec":600 to change them. The CLI path leaves a full-access key for
#     phone.alice.near in your keychain: it is yours, the owner's.)

# 4. Fund with small NEAR: 2 NEAR on top of storage is enough for the demo
near tokens alice.near send-near phone.alice.near '2 NEAR' network-config mainnet sign-with-keychain send

# 5. Save a recipient (owner call, 1 yoctoNEAR), then call the number and say "send 0.5 NEAR to bob dot near", then the PIN
near contract call-function as-transaction phone.alice.near allow json-args '{"recipient":"bob.near"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send

# 6. Base: ask "what's my wallet balance" (the reply and the bind page give the EVM address, the same on every chain).
#    Send a little ETH on Base to that address (0.001 ETH covers 0.0001 ETH + gas many times; Base gas is cents or less).
#    Save the recipient, then text "send 0.0001 ETH on Base to 0x…" on WhatsApp and say/text the PIN.
#    If the address lacks gas, the agent says how much is missing and asks for no signature.
near contract call-function as-transaction phone.alice.near allow json-args '{"recipient":"0x<recipient>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send

# Optional: another EVM chain (limits in that chain's native units, wei)
near contract call-function as-transaction phone.alice.near allow_chain json-args '{"chain_id":42161,"per_tx":"500000000000000","per_day":"2000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send

# Check state any time (free view); stop the agent any time
near contract call-function as-read-only phone.alice.near get_state json-args {} network-config mainnet now
near contract call-function as-transaction phone.alice.near revoke_agent json-args {} prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send
```

Record these three as README "Evidence":

1. The bind transaction (create + deploy + init `phone.alice.near`), nearblocks.io link.
2. A `transfer_near` by voice + PIN, nearblocks.io link.
3. A Base transfer: the `request_signature` NEAR transaction (nearblocks.io) and the broadcast Base transaction (basescan.org).

Testnet still works with `NETWORK=testnet` (Sepolia, `.testnet` accounts, `v1.signer-prod.testnet`): same steps with `network-config testnet`, `sponsor-by-faucet-service` for the agent account, and "send 0.001 ETH on Sepolia to 0x…".

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

## Plan for a top 3 place

The deadline is **14 Nov 2026, 23:59 UTC**: the repo must be public, the X post up and the submission sent by then. Judging is 16–18 Nov. Prizes are 1st, 2nd and 3rd in each of 13 tracks, plus one grand prize. We list every track that fits: `business`, `privacy`, `agents`, `security`, and `memecoins` if item 5 lands.

Claude Code and Codex screen every entry first: they check the README reproduces, verify the features and give a first score. Humans decide after that. So everything below is about evidence a machine can check, and a demo a judge can open.

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| 1 | **Hosted demo with the browser call** on a public URL, kept up until 25 Nov. Judges can't use the WhatsApp test number (it only replies to 5 approved numbers). | Johnson | todo |
| 2 | **GPU voice on the Spark** to cut the lag before the agent speaks (now about 3–5 s). | Johnson | todo |
| 3 | **README a machine can run with no keys**: offline tests, `npm run demo:check`, a "feature → code → how to verify" table. | Claude | in progress |
| 4 | **Full TEE attestation check**, including Intel's signature on the security proof (and the GPU's if possible), shown on a public `/proof` page; `npm run attest`. | Claude | in progress |
| 5 | **A memecoin mechanic: "the coin has a brain".** Each launched coin gets its own AI hotline, paid for by NEARON staking credit bound to the coin. Ask the NEARON team: can a meme.cooking or JustHoot coin be bound, and when is mainnet planned? | Tan + NEARON team | ask |
| 6 | **Proof on chain**, with links in the README: one meme.cooking testnet launch (free), one JustHoot mainnet launch (about 0.1 NEAR), one real Intents deposit (about $1 USDC). Signed in our own wallets. | Tan | todo |
| 7 | **List the agent on NEAR's Agent Market** (market.near.ai/docs: list your agent). | Johnson or Tan | todo |
| 8 | **Demo video, 60–90 s, one complete moment:** a phone call, the coin is live, the link arrives. Start with the user's problem; say concretely what NEAR does (private AI in TEEs, pay in any token through Intents, launch signed in your own wallet). | Tan | todo |
| 9 | **X post** tagging @NEARProtocol and #NEARHackathon (optional @NearLegion @NearBuilders), with the video, repo and demo links. | Tan | todo |
| 10 | **Make the repo public** and **submit once.** Needs: project name, lead name, email, team size, mainnet payout account, consent. The submission can't be resent; fixes go through nearhackathon.com/request-changes. | Tan | todo, by 14 Nov |

How you can help:

- **Johnson:** items 1, 2 and 7. Also try the call yourself and send the worst moment you hit; that's what we fix first.
- **Anyone:** call it, try to break it (a famous ticker, "will it 100x?", "30% off"), and send the transcript from `/dashboard`.

## Rules for this project

- Ask Tan before making the repo public, posting anything, submitting to the hackathon, or switching to mainnet.
- Never commit `.env` or `data/`; both are gitignored.
