# callhand

One number, two desks. You call (in the browser or on WhatsApp), text, or send a photo, and the first thing you say picks the desk:

- **The launch desk** talks you through a memecoin (what it is, name, ticker, logo vibe, auction length, soft cap, optional team allocation and socials), reads it back, and when you say yes sends you a page where you **sign the launch on [meme.cooking](https://meme.cooking) with your own NEAR wallet**. It refuses impersonation, oversized team allocations and promised returns, in code.
- **The business desk** answers for a sample building firm. You describe the job or send a photo; a vision model in a TEE scopes it; quotes, discounts and deposits come from `owner.yaml` through code; the deposit is paid in any token through NEAR Intents. The owner changes the rules by talking to a settings line, inside hard bounds.

Both desks share one engine: the voice and WhatsApp pipeline, NEAR AI Cloud TEE models with per-reply signature checks, the tool loop, the output filter and the ledger. Each desk is a config file, a prompt and tools (`src/desks/`).

The building firm, **Hart & Sons Builders**, is a sample in `owner.yaml`, not a real company.

## Tracks

Memecoins (meme.cooking auctions and JustHoot instant launches on RHEA, by voice), agents (tool-calling desks with rules in code), privacy (all models in TEEs, photos kept locally), security (impersonation and allocation rules, return-promise filter, kill switches, owner diffs with hard bounds, every refusal logged), and business (photo-to-quote and deposits).

## JustHoot (instant launch)

The launch desk supports two launchpads; the caller picks one or the agent suggests one (`set_launchpad`):

- **meme.cooking**: a fair-launch auction first, about 0.22 NEAR. Testnet or mainnet per `NETWORK`.
- **JustHoot** ([justhoot.fun](https://justhoot.fun)): one `launch_meme` call on `v2-launchpad.justhoot.near` creates the token and its RHEA DCL pool (1% fee tier), tradable immediately. **Mainnet only, real NEAR** (there is no testnet deployment), about 0.06 NEAR plus the on-chain logo's storage (about 0.1 NEAR with a 4 KB logo). Deposit and gas come from the contract's `get_launch_deposit` and `get_launch_gas` views; if the signer has no storage on the launchpad, `storage_deposit` goes first in the same transaction. No transfer tax and no dev buy are offered; all supply goes to the creator and the pool. `set_auction` and `set_team_allocation` refuse on JustHoot; tickers are 1 to 10 letters or digits and are not unique there, so the meme.cooking collision check is skipped. All other rules (blocked tickers and names, return-promise filter, kill switch) still apply. Turn it off with `launchpads.justhoot.enabled: false` in `launchpad.yaml`.
- After a JustHoot launch the page links "Give your coin a brain" to [NEARON](https://stg.nearon.dev/#/docs) (stake NEAR, earn CREDIT, bind the coin so its AI agent is paid for). NEARON is a testnet staging prototype today; this is a link only.

Code: `src/justhoot.ts`. Live view-only check: `npm run test:justhoot`. Not verified: no real JustHoot launch has been signed, and the token-id extraction from the launch logs is untested (the page always links the transaction and justhoot.fun).

## Try it (for judges)

Run it (below), open `http://localhost:8787`. No mic? Press **Call** and type.

### Launch desk

| Do this | You should see |
| --- | --- |
| On `/`, pick **Launch**, press **Call** | The greeting, spoken and in the transcript |
| Say "It's a coin about a sleepy otter", then "Call it Sleepy Otter, ticker NEAR" | Refused: `set_coin` returns "NEAR is the ticker of an existing asset". The refusal appears in the ledger on `/dashboard` |
| Try "ticker ELONCAT" or a ticker already on meme.cooking | Refused (brand/celebrity list; meme.cooking's public indexer) |
| Ask "Will it 100x?" | If a reply promises returns, the filter replaces it before it is spoken and logs `Reply filtered` |
| Ask for 25% for the team | Refused: max 10%, cliff at least 7 days, vesting at least 30 days (`launchpad.yaml`) |
| Give a ticker like ZZZ, a logo vibe, "one hour, soft cap 100 NEAR", then say yes to the summary | A green box **Open your launch**; on WhatsApp the link arrives as a message |
| Open the launch page, **Connect a wallet** (Meteor, HOT, Intear, MyNearWallet) | The logo, the agreed terms, and the exact NEAR cost read from the contract's `create_meme_storage_cost` view for your account (plus 0.02 NEAR registration if you are new to meme.cooking) |
| Press **Sign and launch** and approve in your wallet | The server reads the transaction back from chain and shows **meme #id** with links to meme.cooking and the explorer; the dashboard shows the launch as Live |
| On `/`, type into **Try to launch a ticker** | The ticker rule answers live, from the same code the tool calls |

### Business desk

| Do this | You should see |
| --- | --- |
| Pick **Business**, call, say "Hi, I need a new kitchen", or press **Photo** and send a picture of a room | With a photo: a `photo →` line (Qwen3-VL's description) and a reply that uses it |
| Ask "Can you do 30% off?" | Refused by `quote_job`: "Max discount is 10%" |
| Give a name and postcode, say "OK, book it for Tuesday" | **Pay the deposit** box; the pay page quotes 1Click in any token, the owner receives USDC |
| On `/dashboard`, **Settings line**, type "max 15% off and no roofs" | The agent reads back a diff; say "yes" and `owner.yaml` is rewritten (comments kept), `Rules changed` in the ledger. Try "40% off": refused by the hard bound (0–30%) |

`/dashboard` shows both desks: calls with a **TEE-signed** badge on each verified reply, launches (prepared, live, failed), jobs and deposits, the ledger of every refusal and change, the rules, and the attestation of all four models.

## NEAR tech used

- **NEAR AI Cloud, private inference** (`src/ai.ts`, `src/image.ts`). Chat `Qwen/Qwen3.6-35B-A3B-FP8`, speech-to-text `openai/whisper-large-v3`, photo reading `Qwen/Qwen3-VL-30B-A3B-Instruct`, logos `black-forest-labs/FLUX.2-klein-4B`, all `owned_by: nearai` (Intel TDX + NVIDIA confidential GPUs). For each model we fetch the attestation report with a fresh nonce and check that the TDX quote's report data binds the signing address and our nonce. Every chat and vision reply's signature is fetched and verified (ECDSA recover) against that key.
- **meme.cooking on NEAR** (`src/memecook.ts`). Mainnet `meme-cooking.near`; testnet `factory.v10.meme-cooking.testnet` (the address in meme.cooking's developer docs; it whitelists `wrap.testnet`). One transaction: `storage_deposit` (only if `storage_balance_of` is null; deposit = `storage_costs.account`) + `create_meme` (250 Tgas, deposit = `create_meme_storage_cost`), arguments in the shape of the contract's published ABI. After signing, the server reads the transaction with `EXPERIMENTAL_tx_status` and takes the meme id from the `create_meme` event or the return value.
- **NEAR Wallet Selector** (`app/routes/launch.$id.tsx`): Meteor, HOT, Intear, MyNearWallet on the configured network. The server never holds a key and never signs.
- **NEAR Intents 1Click** (`src/pay.ts`): `EXACT_OUTPUT` quotes for building deposits (USDC to the owner) and, optionally and on mainnet only, "fund this launch from another chain": exactly the launch cost delivered to your NEAR account as wNEAR.
- **WhatsApp Cloud API calling** (`src/whatsapp.ts`): calls over WebRTC (werift + Opus), text messages, and photos downloaded through the Graph API media endpoint.

## Run it

Requires Node 22+.

```bash
npm install
cp .env.example .env      # at least NEARAI_API_KEY; NETWORK=testnet by default
npm run dev               # http://localhost:8787  (UI + voice + webhooks, one port)
```

Production: `npm run build && npm start`.

Checks:

```bash
npm test                  # offline: ticker/name/auction/team rules, return filter, router, create_meme args, pricing, owner diff + bounds
npm run test:meme         # builds the create_meme tx for a sample and calls create_meme_storage_cost on testnet over RPC (view only)
npm run test:meme mainnet # the same on mainnet
npm run typecheck
npm run seed              # demo data in data/demo-db.json; run with DB_FILE=data/demo-db.json npm run dev
```

### Environment

| Variable | What it is |
| --- | --- |
| `NEARAI_API_KEY` | NEAR AI Cloud key. Needed for chat, STT, vision and logos. Attestation works without it |
| `NETWORK` | `testnet` (default) or `mainnet` for launches |
| `PUBLIC_URL` | Public URL of this server, used in launch and deposit links |
| `PINATA_JWT` | Optional. Pins the coin's description and links to IPFS (the reference meme.cooking's app uses) |
| `OWNER_NEAR_ACCOUNT` | Business desk: mainnet account that receives USDC deposits |
| `OWNER_WHATSAPP` | Business desk: the owner's number; it reaches the settings desk instead of the router |
| `ONECLICK_JWT` | Optional 1Click partner JWT (without it 1Click adds a 0.2% fee) |
| `DASHBOARD_PASSWORD` | Optional basic auth on `/dashboard`, `/api/state`, `/api/owner` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API |

### WhatsApp setup (Meta's free test number)

1. Create an app at developers.facebook.com (type Business), add **WhatsApp**, add your phone as a test recipient.
2. Copy the access token to `WHATSAPP_TOKEN`, the phone number ID to `WHATSAPP_PHONE_NUMBER_ID`, the app secret to `WHATSAPP_APP_SECRET`; pick any `WHATSAPP_VERIFY_TOKEN`.
3. Expose the server (`cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_URL`.
4. Set the webhook to `<PUBLIC_URL>/webhooks/whatsapp`, subscribe to **messages** and **calls**.
5. In WhatsApp Manager, your number, **Call settings**, allow voice calls.
6. Call or message the number: "I want to launch a memecoin" or "my tap is leaking", or send a photo.

## How it is built

- `src/agent.ts`: the shared runtime: desk router (plain keywords on the first message, `?desk=` on the browser call, or the owner's number), tool loop, output filter, link hook, photo intake.
- `src/desks/launch.ts` + `launchpad.yaml`: launch rules (`checkTicker`, `checkName`, `checkAuction`, `checkTeam`, `filterClaims`), all re-checked at `prepare_launch`, kill switch.
- `src/desks/business.ts` + `owner.yaml`: pricing (`priceFor`), refused work, kill switch.
- `src/desks/owner.ts`: the settings line: `planChange` (hard bounds) → owner confirms → `applyDiff` rewrites `owner.yaml`, keeping comments and the `${OWNER_NEAR_ACCOUNT}` placeholder.
- `src/justhoot.ts`: JustHoot's `launch_meme` args, cost from its views, the transaction, and the after-the-fact check.
- `src/memecook.ts`: RPC views, `createMemeArgs`, `launchCost`, `buildTx`, `confirmTx`, and the meme.cooking indexer for existing tickers.
- `app/`: TanStack Start UI: `/`, `/launch/$id`, `/pay/$jobId`, `/dashboard`, and the `/api/*` routes.
- `server.ts`: one Node process on one port: Vite middleware in dev, the built handler in prod, the voice WebSocket and WhatsApp webhook on the same server.

## Verified, and not

Verified here: `create_meme_storage_cost` accepts our arguments on testnet and mainnet (`npm run test:meme`), the testnet contract whitelists `wrap.testnet`, the meme.cooking indexer is reachable, all four models return attestation reports whose quotes bind the key and nonce, the rule tests pass, and typecheck and the production build pass.

Not verified here: a real signed `create_meme` (that needs a funded wallet and a person to sign; this project never signs), the chat, STT, vision and image calls (they need `NEARAI_API_KEY`), and the exact response shape of NEAR AI's image endpoint (we send the OpenAI-compatible `/v1/images/generations` request and accept `b64_json` or `url`; if it fails, the desk draws a placeholder coin and says so). The storage-cost view does not validate everything `create_meme` checks, so the first real launch is the true test of an empty `reference`/`reference_hash` and of `team_allocation`.

## Honest limitations

- Without `PINATA_JWT`, launches go out with an empty metadata reference: the description and links live on our launch page, not on meme.cooking.
- The existing-ticker check uses meme.cooking's mainnet indexer (`api.meme.cooking`), which is where impersonation matters; the testnet site may differ.
- No barge-in on WhatsApp calls. The browser call uses a simple energy voice detector.
- Attestation is partial: it binds the signing key and our nonce in the TDX quote but does not verify Intel's signature on the quote or the GPU evidence. Use the NEAR AI Verification Center for the full chain. Logo generation has no per-response signature check.
- Funding from another chain arrives as wNEAR and needs unwrapping before signing; 1Click has no testnet.
- Storage is one JSON file. Photos are stored in `data/photos/` on this server only.

## Credits

Typefaces, SIL Open Font Licence, from `@fontsource`: **Archivo Black** and **Hanken Grotesk**. The coin on the landing page and the placeholder logos are drawn in code.

Photographs (business desk):

- "End of terrace house, Elwood Street, Highbury, London N5" by Jim Osley, CC BY-SA 2.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=105321989
- "Black Claw Hammer on Brown Wooden Plank" by Homedust, CC BY 2.0, Flickr: https://www.flickr.com/photos/159630537@N08/28918563378
- "GOC Hampstead 107 Kenwood House (scaffolded)" by Peter O'Connor, CC BY-SA 2.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=106415915
- "Mozart Terrace, Ebury Road, London" by Oosoom, CC BY-SA 3.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=3581977

## Licence

MIT, see `LICENSE`. The photographs keep their own licences.
