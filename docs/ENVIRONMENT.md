# Environment variables

A fresh clone needs none of these: without keys every send and packet is a labelled dry run. `.env.example` lists them with comments. The code that reads them is `src/config.ts`.

| Variable | What it is |
| --- | --- |
| `NEARAI_API_KEY` | NEAR AI Cloud key, for chat, speech-to-text and image |
| `MOCK_LLM` | `1`: a scripted model and fake speech-to-text; no key needed |
| `NETWORK` | `testnet` (default) or `mainnet` |
| `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY` | The agent's account. Without them every send is a dry run |
| `FACTORY_ACCOUNT_ID`, `CUSTODY_ACCOUNT_ID`, `CUSTODY_PRIVATE_KEY` | The wallet factory, and the custody account that owns phone-only wallets |
| `PACKETS_ACCOUNT_ID` | The packets contract. Without it packets are dry runs |
| `PACKET_EXPIRY_SEC` | How long a packet stays open. Default 86400 (24 hours) |
| `DEMO_WALLET_PHONE`, `DEMO_PIN`, `DEMO_RECIPIENT` | The website's shared demo wallet. Its PIN is shown on the page |
| `DEMO_PACKET_NEAR`, `DEMO_PACKET_WORDS`, `DEMO_PACKETS_PER_DAY` | The demo packet on `/packet/demo`: its size (default 0.02), the words it takes in turn, and how many times it is remade in 24 hours (default 10) |
| `DEMO_VISITOR_PACKET_NEAR`, `DEMO_VISITOR_PACKET_EXPIRY_SEC`, `DEMO_VISITOR_PACKETS_OPEN`, `DEMO_VISITOR_PACKETS_PER_DAY` | Caps on packets that visitors make from the demo wallet. Defaults: 0.02 NEAR, 3600 seconds, 3 open at once, 10 in 24 hours |
| `WALLET_SECRET` | Key for the phone-number hashes on chain and the PIN pepper. Required on mainnet |
| `WALLET_NEAR_PER_TX`, `WALLET_NEAR_PER_DAY`, `SMALL_LIMIT`, `SMALL_LIMIT_USDC`, `WALLET_DELAY_SEC` | Default limits, the PIN-only ceilings, and the wait for new recipients (default 600 seconds) |
| `PUBLIC_URL`, `DASHBOARD_PASSWORD` | This server's address; the password for `/dashboard` and `/api/state` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_NUMBER` | WhatsApp Cloud API |
| `TTS`, `TTS_PROVIDER`, `CARTESIA_API_KEY` | Voice: `TTS=off` for text only; `TTS_PROVIDER` is `cartesia` (cloud, the reply text leaves the server) or `kokoro` (on this machine) |
| `EVM_ENABLED` | Off by default. Not part of the hackathon submission |
| `RINGFENCE_URL` | Only for `npm run live:check`: the site to check. Default is the live site |

Production setup: [deploy/README.md](../deploy/README.md). The contract files for mainnet and their hashes: [contracts/release/README.md](../contracts/release/README.md).
