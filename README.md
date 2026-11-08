# Ringfence

**Problem.** Small operators answer the phone all day: a builder taking quote requests and deposits, or someone who wants to launch a memecoin but cannot use a launchpad's forms or a wallet CLI. A voice agent could do both, but then the caller's voice, photos and plans go to an AI provider, and the agent itself may promise things, take payment wrongly, or launch an impersonating token. **Product.** Ringfence is one phone line (browser call or WhatsApp call/text/photo) with two desks: a **launch desk** that talks you through a memecoin and hands you a page to sign the launch yourself, and a **business desk** that quotes building work from a description or photo and takes a deposit. Every rule (refused tickers, allocation caps, discount caps, deposit bounds) is code, not prompt. **NEAR's role.** (1) All four models (chat, speech-to-text, photo reading, logos) run in TEEs on NEAR AI Cloud; this server verifies each model's Intel TDX quote, the key and nonce it binds, and its NVIDIA GPU attestation, and checks the signature on every chat and vision reply. (2) Deposits are paid in any token on any chain and settle to the owner as USDC on NEAR through NEAR Intents 1Click. (3) Coin launches go to meme.cooking (auction, testnet or mainnet) or JustHoot (instant RHEA pool, mainnet), signed in the caller's own NEAR wallet through Wallet Selector; the server never holds a key.

The building firm, **Hart & Sons Builders**, is a sample in `owner.yaml`, not a real company.

## Run it with no keys in 2 minutes

Node 22+. No `.env`, no API key, no wallet, no network needed for the steps marked offline.

```bash
npm ci
npm test              # offline: 16 rule tests (tickers, names, auction, team, return filter, router, create_meme and launch_meme args, pricing, owner bounds)
npm run typecheck
npm run build
npm run demo:check    # offline: starts the built server with MOCK_LLM=1 and no .env, walks a launch and a booking over the call socket, checks the pages, stops the server
```

`npm run demo:check` prints one line per step. Expected output:

```
PASS  server starts with MOCK_LLM=1, no .env, no key  (port …)
PASS  launch desk: refuses ticker NEAR, then prepares a launch over the call socket  (http://localhost:…/launch/…)
PASS  launch page renders (/launch/:id) with the agreed terms  ($ZZOTR, 60 min, soft cap 100 NEAR, prepared, logo: drawn locally)
PASS  business desk: refuses 30% off, quotes, books, sends a deposit link  (http://localhost:…/pay/…)
PASS  pay page renders (/pay/:jobId) with the deposit  (Kitchen fitting, $8250, deposit $1650)
PASS  ledger records the refusals, the launch and the booking  (7 entries)
PASS  dashboard and /proof pages render
```

To click through it yourself: `MOCK_LLM=1 npm start` (add `TTS=off` to skip downloading the local Kokoro voice, about 90 MB), open `http://localhost:8787`, pick a desk, press **Call**, and type into the call box. In mock mode the model is replaced by a small keyword script (`mockStep` in `src/ai.ts`) that makes the same tool calls a model would; the tools, rules, pages and ledger are the real ones. Type these lines:

| Desk | Type | You should see |
| --- | --- | --- |
| Launch | `Call it Sleepy Otter, ticker NEAR` | "Sorry, I can't do that: NEAR is the ticker of an existing asset" (refused in `checkTicker`), logged as Refused on `/dashboard` |
| Launch | `Call it Sleepy Otter, ticker ZZOTR` | Accepted |
| Launch | `Logo vibe: a sleepy otter on a pillow` | Without a key the image model is skipped and a placeholder coin is drawn locally (the page says so) |
| Launch | `One hour, soft cap 100 NEAR` | Accepted (`checkAuction`). `One hour, soft cap 1` is refused |
| Launch | `I want 25% for the team` | Refused: max 10% (`checkTeam`) |
| Launch | `Yes, set it up` | **Open your launch** box. The page shows the terms and, after **Connect a wallet**, the exact NEAR cost from the testnet contract (needs network) |
| Business | `I need a new kitchen, can you do 30% off?` | "Max discount is 10%" (`priceFor`) |
| Business | `OK, no discount then, what is the quote?` | $8250, deposit $1650 from `owner.yaml` |
| Business | `My name is Sam Lee, postcode N5 1AA`, then `OK, book it for Tuesday` | **Pay the deposit** box. The pay page lists tokens and quotes through 1Click (needs network; quotes are `dry` until you press pay) |

With network but still no key: `npm run attest` verifies the TEE attestation of all four models (below), and `npm run test:meme` / `npm run test:justhoot` / `npm run test:quote` call the meme.cooking and JustHoot view methods and a dry 1Click quote.

## Feature → where in the code → how to verify

| Feature | Code | Verify |
| --- | --- | --- |
| Ticker/name impersonation refused (blocked list, existing meme.cooking tickers) | `src/desks/launch.ts` `checkTicker`, `checkName`; `launchpad.yaml` | `npm test` (ticker impersonation, name impersonation); `npm run demo:check` step 2 |
| Auction bounds, team allocation cap with cliff and vesting | `checkAuction`, `checkTeam` | `npm test` (auction bounds, team allocation) |
| No promised returns: replies filtered sentence by sentence before they are spoken | `filterClaims`, `src/speech.ts` `sentenceSplitter` | `npm test` (no promised returns, streamed sentences + per-sentence filter) |
| All rules re-checked at the last step; kill switch | `prepare_launch` in `src/desks/launch.ts` | `npm test` (justhoot prepare_launch); set `kill_switch: true` in `launchpad.yaml` and walk the demo |
| meme.cooking `create_meme` transaction, signed by the caller | `src/memecook.ts` `createMemeArgs`, `buildTx`, `confirmTx`; `app/routes/launch.$id.tsx` | `npm test` (create_meme args); `npm run test:meme` (testnet view) / `npm run test:meme mainnet` |
| JustHoot `launch_meme` (token + RHEA pool in one call), cost from the contract's views | `src/justhoot.ts` | `npm test` (justhoot args, justhoot prepare_launch); `npm run test:justhoot` (mainnet views) |
| Wallet Selector: Meteor, HOT, Intear, MyNearWallet; server never signs | `app/routes/launch.$id.tsx` | Open a launch page, **Connect a wallet** |
| Business pricing, discount cap, deposits from `owner.yaml` | `src/desks/business.ts` `priceFor` | `npm test` (business pricing rules); `npm run demo:check` step 4 |
| Deposit in any token, settled to USDC through NEAR Intents 1Click (`EXACT_OUTPUT`) | `src/pay.ts`; `app/routes/pay.$jobId.tsx` | `npm run test:quote` (dry quotes from Base USDC, Solana SOL, wNEAR) |
| Owner changes rules by talking, inside hard bounds; YAML rewritten with comments kept | `src/desks/owner.ts` `planChange`, `applyDiff` | `npm test` (owner desk bounds + write) |
| Desk router and returning-caller memory | `src/agent.ts` `route`; `src/memory.ts` | `npm test` (router, returning caller) |
| TEE attestation: Intel TDX quote signature + TCB status, key+nonce in report_data, NVIDIA GPUs via NRAS | `src/ai.ts` `attest`, `verifyIntelQuote`, `verifyGpu` | `npm run attest` (no key); `/proof`; `/api/proof?fresh=1` |
| Every chat/vision reply's signature recovered and matched to the attested key | `src/ai.ts` `chat`, `verifyLater` | Needs `NEARAI_API_KEY`: call, then see **TEE-signed** badges on `/dashboard` |
| Photo → job scope by a vision model in a TEE; photo stays on this server | `src/image.ts` `describePhoto`; `src/agent.ts` `photo` | Needs key: **Photo** button on the business desk |
| Voice: TTS (Cartesia Sonic in the cloud, or local Kokoro), Whisper STT in a TEE, barge-in, fillers | `src/tts.ts`, `src/turn.ts`, `src/voice.ts` | `MOCK_LLM=1 npm run test:latency`; a browser call |
| WhatsApp calls (WebRTC/Opus), text and photos | `src/whatsapp.ts` | Needs Meta test number, see [WhatsApp setup](#whatsapp-setup-metas-free-test-number) |
| Ledger of every refusal, filter hit, launch, booking, rule change | `src/store.ts` `log`; `/dashboard` | `npm run demo:check` step 6 |

## Tracks and the hints each feature uses

- **Memecoins**: launching on meme.cooking (auction, testnet/mainnet) and JustHoot (instant RHEA DCL pool, mainnet) by voice; anti-rug rules in code (team cap with cliff and vesting, no promised returns, impersonation blocks, existing-ticker check against meme.cooking's indexer); the caller signs in their own wallet.
- **Agents**: tool-calling desks on one runtime, each a config file + prompt + tools; rules enforced in tool code, not in the prompt; the owner edits the agent's rules by talking to it, with a diff and hard bounds.
- **Privacy**: NEAR AI Cloud private inference for every model (chat, STT, vision, image), with attestation verified in this process (Intel TDX + NVIDIA NRAS) and signed replies; speech-to-text and the LLM stay in NEAR AI TEEs; text-to-speech is either Cartesia (cloud: the reply text goes to Cartesia, a third party, not a TEE) or local Kokoro (`TTS_PROVIDER=kokoro`: the text never leaves the box); photos are stored only on this server.
- **Security**: attestation verified rather than trusted, per-reply signature checks, impersonation and allocation rules, output filter, kill switches, owner rule changes bounded and logged, server never holds keys, owner pages behind basic auth (`DASHBOARD_PASSWORD`).
- **Business**: an AI receptionist for a small business: photo-to-quote, bookings, and deposits in any token settled to USDC through NEAR Intents 1Click.

## TEE attestation, in detail

`npm run attest` (network only, no key) fetches `https://cloud-api.near.ai/v1/attestation/report` for each model with a fresh 32-byte nonce and checks:

1. **Intel TDX quote**: signature, QE report and PCK certificate chain up to Intel's SGX root CA, with collateral (TCB info, QE identity, CRLs) fetched from Intel PCS (`api.trustedservices.intel.com`), using [`@phala/dcap-qvl`](https://github.com/Phala-Network/dcap-qvl) (pure JS). Prints the TCB status (for example `UpToDate`) and any advisory IDs. A quote with one flipped byte is rejected ("ISV enclave report signature is invalid").
2. **report_data** (read from the verified quote) equals the model's signing address, zero-padded to 32 bytes, followed by our nonce.
3. **NVIDIA GPUs**: `nvidia_payload` (8 × H100 evidence carrying our nonce) is posted to NVIDIA NRAS `/v3/attest/gpu`; the returned platform and per-GPU JWTs are verified (ES384) against NVIDIA's JWKS, and the overall result, each GPU's measurement result and nonce match must be true.

Output on 2026-11-08 (abridged): all four models `PASS` on all three checks, TCB `UpToDate`, `8 x HOPPER`, "4/4 models fully verified". The same results are on `/proof` (public) and `/dashboard`, and chat replies only get the **TEE-signed** badge when their signer is a key that passed checks 1 and 2.

Not checked: that the TD measurements (MRTD, RTMR0-3) and the event log match a published, reproducible NEAR AI image, and the `gateway_attestation` of NEAR AI's gateway. For those, follow [docs.near.ai/cloud/verification](https://docs.near.ai/cloud/verification/).

## NEAR tech used

- **NEAR AI Cloud, private inference** (`src/ai.ts`, `src/image.ts`). Chat `Qwen/Qwen3.6-35B-A3B-FP8`, speech-to-text `openai/whisper-large-v3`, photo reading `Qwen/Qwen3-VL-30B-A3B-Instruct`, logos `black-forest-labs/FLUX.2-klein-4B`, all `owned_by: nearai` (Intel TDX + NVIDIA confidential GPUs). For each model we fetch the attestation report with a fresh nonce and verify the Intel TDX quote, the key and nonce in its report data, and the NVIDIA GPU evidence (see [TEE attestation, in detail](#tee-attestation-in-detail)). Every chat and vision reply's signature is fetched and verified (ECDSA recover) against that key.
- **meme.cooking on NEAR** (`src/memecook.ts`). Mainnet `meme-cooking.near`; testnet `factory.v10.meme-cooking.testnet` (the address in meme.cooking's developer docs; it whitelists `wrap.testnet`). One transaction: `storage_deposit` (only if `storage_balance_of` is null; deposit = `storage_costs.account`) + `create_meme` (250 Tgas, deposit = `create_meme_storage_cost`), arguments in the shape of the contract's published ABI. After signing, the server reads the transaction with `EXPERIMENTAL_tx_status` and takes the meme id from the `create_meme` event or the return value.
- **NEAR Wallet Selector** (`app/routes/launch.$id.tsx`): Meteor, HOT, Intear, MyNearWallet on the configured network. The server never holds a key and never signs.
- **NEAR Intents 1Click** (`src/pay.ts`): `EXACT_OUTPUT` quotes for building deposits (USDC to the owner) and, optionally and on mainnet only, "fund this launch from another chain": exactly the launch cost delivered to your NEAR account as wNEAR.
- **WhatsApp Cloud API calling** (`src/whatsapp.ts`): calls over WebRTC (werift + Opus), text messages, and photos downloaded through the Graph API media endpoint.

## Try it with keys (full voice demo)

With `NEARAI_API_KEY` set (see [Run it with keys](#run-it-with-keys)), open `http://localhost:8787`. No mic? Press **Call** and type.

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

`/dashboard` shows both desks: calls with a **TEE-signed** badge on each verified reply, launches (prepared, live, failed), jobs and deposits, the ledger of every refusal and change, the rules, and the verified attestation of all four models. `/proof` shows the same attestation publicly, with every check.

## JustHoot (instant launch)

The launch desk supports two launchpads; the caller picks one or the agent suggests one (`set_launchpad`):

- **meme.cooking**: a fair-launch auction first, about 0.22 NEAR. Testnet or mainnet per `NETWORK`.
- **JustHoot** ([justhoot.fun](https://justhoot.fun)): one `launch_meme` call on `v2-launchpad.justhoot.near` creates the token and its RHEA DCL pool (1% fee tier), tradable immediately. **Mainnet only, real NEAR** (there is no testnet deployment), about 0.06 NEAR plus the on-chain logo's storage (about 0.1 NEAR with a 4 KB logo). Deposit and gas come from the contract's `get_launch_deposit` and `get_launch_gas` views; if the signer has no storage on the launchpad, `storage_deposit` goes first in the same transaction. No transfer tax and no dev buy are offered; all supply goes to the creator and the pool. `set_auction` and `set_team_allocation` refuse on JustHoot; tickers are 1 to 10 letters or digits and are not unique there, so the meme.cooking collision check is skipped. All other rules (blocked tickers and names, return-promise filter, kill switch) still apply. Turn it off with `launchpads.justhoot.enabled: false` in `launchpad.yaml`.
- After a JustHoot launch the page links "Give your coin a brain" to [NEARON](https://stg.nearon.dev/#/docs) (stake NEAR, earn CREDIT, bind the coin so its AI agent is paid for). NEARON is a testnet staging prototype today; this is a link only.

Code: `src/justhoot.ts`. Live view-only check: `npm run test:justhoot`. Not verified: no real JustHoot launch has been signed, and the token-id extraction from the launch logs is untested (the page always links the transaction and justhoot.fun).

## Phone wallet: your phone number is a wallet on every EVM chain

> **Unaudited prototype: keep small amounts.** The phone-wallet contract has not been audited. On mainnet it moves real money; the defaults are deliberately small.

Bind your NEAR account (`.near` on mainnet, `.testnet` on testnet, per `NETWORK`) to your WhatsApp number once on `/wallet/bind`. Then on a call: "send 1 NEAR to bob.near" or "send 0.0001 ETH on Base to 0x…" (addresses are easier typed in WhatsApp), hear it read back ("0.0001 ETH on Base to address 0x1111 ending 2222"), say your 4-digit PIN, and it executes on chain within limits a smart contract enforces, not the AI. The explorer link (nearblocks, basescan, arbiscan, …) arrives on WhatsApp.

**How it works**

1. `/wallet/bind`: connect your wallet (wallet selector), get a 6-digit code on WhatsApp, set a PIN (stored only as a salted scrypt hash). The page shows your EVM address and the limits, which you can edit, then you sign one transaction from your own account: create `phone.<you>.near`, fund it, deploy `contracts/phone-wallet`, call `new(owner = you, agent = AGENT_ACCOUNT_ID, phone_hash = sha256(your number), signer = v1.signer, evm_chain_ids = [8453], near_limit, evm_limit, new_recipient_delay_sec)`. On testnet the signer is `v1.signer-prod.testnet` and the chain is Sepolia (11155111). Nothing runs until you sign.
2. On a call the router sends "send / transfer / balance / wallet" to the **wallet desk** (`src/desks/wallet.ts`): `get_balance`, `prepare_transfer({to, amount, asset})` (reads back), `confirm_transfer({pin})`. `asset` is `near` or a chain name (`base`, `ethereum`, `arbitrum`, `optimism`, `polygon`, `bnb`, `avalanche`); plain "ETH" gets "which chain?". The PIN is checked against the hash; 3 wrong tries lock it for 15 minutes; the PIN is blanked from the stored transcript and the tool log.
3. With the PIN right, the server calls your contract with the agent key (`near-api-js`): `transfer_near` for NEAR, `request_signature` for EVM chains.
4. Over a limit, or a recipient not on your saved list: the agent says so and texts a link (`/wallet/send`) to sign it in your own wallet instead. An unbound number is told to bind first, with the link.

**EVM chains through Chain Signatures.** One MPC path (`ethereum-1`) gives your contract **the same EVM address on every EVM chain**; you fund gas on whichever chain you want to use. The address is derived as NEAR's MPC does (`src/eth.ts`; checked in `npm test` against the live `derived_public_key` views of both `v1.signer` (mainnet) and `v1.signer-prod.testnet`). Chains come from a small registry (`src/chains.ts`: Ethereum 1, Base 8453, Arbitrum 42161, Optimism 10, Polygon 137, BNB Chain 56, Avalanche 43114, plus Sepolia; more with `EXTRA_CHAINS`, RPCs overridable with `RPC_<chainId>`). The server builds an EIP-1559 transfer (nonce and fees from the chain's public RPC) and **checks gas first**: if the address holds less than value + maxFee × 21000, it says how much is missing and which address to fund, and no signature is requested. The contract parses the unsigned transaction itself (minimal RLP: the chain id must be on the owner's chain allowlist and match `evm:<chainId>`, `to` an address, no calldata, no access list), applies that chain's limits to the value it parsed, and calls `sign({request: {path, payload_v2: {Ecdsa: keccak256(tx)}, domain_id: 0}})` on the MPC signer with 1 yoctoNEAR. The signature comes back as the call's result; the server attaches it and broadcasts to that chain.

**Which chains are on.** Mainnet: **Base** is enabled at bind with small limits. The other registry chains are known to the server but the contract refuses them until the owner allows them, with their own limits in that chain's native units (wei for ETH, BNB, POL, AVAX):

```bash
near contract call-function as-transaction phone.alice.near allow_chain json-args '{"chain_id":42161,"per_tx":"500000000000000","per_day":"2000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send
```

Next: non-EVM chains (Bitcoin, Solana through the same MPC signer's other domains) are not supported yet.

**Trust model and limits.** The contract is the only thing that can move funds, and it checks every agent call. **It is an unaudited prototype: keep small amounts in it.**

| Rule | Enforced in `contracts/phone-wallet/src/lib.rs` |
| --- | --- |
| Per transfer and per day, per asset (`near`, `evm:<chainId>`) | Mainnet defaults 1 / 3 NEAR and 0.0005 / 0.002 per EVM chain (native units); editable on the bind page before signing; owner changes later with `set_limits`. Over → panic with the reason |
| EVM chains on an owner allowlist | `allow_chain(chain_id, per_tx, per_day)` / `disallow_chain`; a chain not allowed, or without a limit, is refused; the tx's chain id must match |
| Saved recipients go instantly; new ones queue | `new_recipient_delay_sec` = 600; `execute(id)` after the delay, owner `cancel(id)` before |
| Owner keeps full control | `withdraw(amount)` always works (the agent can't block it), `set_agent`, `revoke_agent`, `allow`/`disallow`, `allow_chain`/`disallow_chain`, `set_delay`; all need 1 yoctoNEAR so a dapp's function-call key can't call them |
| The agent is never the owner | checked at init and in `set_agent` |
| EVM chain, value and recipient are the ones signed | parsed from the transaction bytes the contract hashes and sends to the signer |
| A phone can't borrow someone else's contract | the owner signs `phone_hash` at init; the server checks it before every call |

What the AI can do if it goes wrong: ask the contract for transfers inside your limits to your saved recipients after a correct PIN. What the server operator could do with the agent key: the same, without the PIN (the PIN protects against someone else calling from a spoofed or stolen line, not against us). Your cap on that is the daily limit per asset; `revoke_agent` ends it.

**Verified and not.** Verified locally: 23 contract unit tests (limits, mainnet defaults, day rollover with mocked time, allowlist vs delay queue, cancel, owner-only methods, revoke, RLP parsing, chain allowlist, chain id mismatch, chain without limit, Base tx vector) and a near-workspaces sandbox test (real transfers, the delay with fast-forward, owner withdraw while the agent is set, agent locked out of owner methods and after revoke, `request_signature` for Sepolia and Base routed to a mock MPC signer with the wallet as predecessor and the right request shape, a non-allowed chain refused); `npm test` (PIN normalization, lockout, intent → tool args incl. "on Base", chain registry, ETH derivation against the live mainnet and testnet MPC views, Sepolia and Base EIP-1559 bytes identical to the contract's test vectors, the gas-check refusal with a mocked RPC, signature assembly); `demo:check` walks "send 1 NEAR to bob.testnet" + PIN to a clearly labelled **DRY RUN**. Not verified: nothing has been deployed or sent on mainnet, testnet, Base or Sepolia; the real MPC signer's response going through `getTransactionLastResult`; which wallets accept the create + deploy + init transaction on `/wallet/bind` (CLI fallback in HANDOVER.md); a queued EVM transfer can go stale (its nonce and fees are fixed when queued); the public RPCs' rate limits. `ft_transfer` and ERC-20s are not implemented.

`AGENT_ACCOUNT_ID` / `AGENT_PRIVATE_KEY` turn it on; without them it is a dry run.

## Run it with keys

```bash
npm ci
cp .env.example .env      # at least NEARAI_API_KEY; NETWORK=testnet by default
npm run dev               # http://localhost:8787  (UI + voice + webhooks, one port)
```

Production: `npm run build && npm start`, or on a VPS with Docker/systemd + Caddy: `deploy/README.md`. Demo data: `npm run seed`, then `DB_FILE=data/demo-db.json npm run dev`.

### Environment

| Variable | What it is |
| --- | --- |
| `NEARAI_API_KEY` | NEAR AI Cloud key. Needed for chat, STT, vision and logos. Attestation works without it |
| `MOCK_LLM` | `1`: scripted model with tool calls, fake STT; no key needed |
| `TTS` | `off`: text only, no voice at all |
| `TTS_PROVIDER` | `cartesia` (default when `CARTESIA_API_KEY` is set) or `kokoro` (local). With cartesia the reply text goes to Cartesia; Kokoro is not loaded unless `TTS_FALLBACK=kokoro` |
| `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, `TTS_SPEED` | Cartesia Sonic (`/tts/bytes`, raw f32 PCM 24 kHz); default voice "Jacqueline" |
| `RTC_PORT_MIN`, `RTC_PORT_MAX` | Fixed UDP range for WhatsApp call audio (e.g. 40000–40100), so a firewall can open it. See `deploy/README.md` |
| `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY` | Phone wallet agent on `NETWORK`; without them the wallet desk is a dry run |
| `NETWORK` | `testnet` (default) or `mainnet` for launches and the phone wallet (mainnet: Base, `v1.signer`) |
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
- `src/ai.ts`: NEAR AI Cloud chat and STT, per-reply signature checks, the attestation verifier (Intel TDX + NVIDIA NRAS), and the `MOCK_LLM` script.
- `app/`: TanStack Start UI: `/`, `/launch/$id`, `/pay/$jobId`, `/dashboard`, `/proof`, and the `/api/*` routes.
- `scripts/demo-check.ts`, `scripts/attest.ts`: the headless no-key smoke test and the attestation report.
- `server.ts`: one Node process on one port: Vite middleware in dev, the built handler in prod, the voice WebSocket and WhatsApp webhook on the same server.

## Evidence (on-chain)

To be filled after the team runs them; none of these has been done by this code's authors yet.

| What | Link |
| --- | --- |
| meme.cooking launch on testnet, signed through `/launch/:id` | TODO: testnet explorer link to the `create_meme` transaction |
| JustHoot launch on mainnet, signed through `/launch/:id` | TODO: nearblocks link to the `launch_meme` transaction |
| A real NEAR Intents 1Click deposit through `/pay/:jobId` | TODO: origin-chain deposit tx and the 1Click status / NEAR settlement tx |
| Phone wallet: create + deploy + init `phone.<you>.near` through `/wallet/bind` | TODO: nearblocks.io link |
| Phone wallet: a NEAR transfer by voice + PIN (`transfer_near`) | TODO: nearblocks.io link |
| Phone wallet: a Base transfer through Chain Signatures (`request_signature` + broadcast) | TODO: nearblocks.io link and basescan.org link |
| Demo video and X post | TODO |

## Verified, and not

Verified here (2026-11-08): `npm test` 22 passed; `npm run typecheck` and `npm run build` pass; `npm run demo:check` all 9 steps pass with no `.env`; `npm run attest` verifies all four models (Intel TDX quote, TCB `UpToDate`, key+nonce binding, 8 NVIDIA H100 GPUs through NRAS); `create_meme_storage_cost` accepts our arguments on testnet and mainnet (`npm run test:meme`); the testnet contract whitelists `wrap.testnet`; the meme.cooking indexer is reachable; dry 1Click quotes return for Base USDC, Solana SOL and wNEAR (`npm run test:quote`).

Not verified here: a real signed `create_meme` or `launch_meme` and a real 1Click deposit (they need a funded wallet and a person to sign; the launch and deposit paths never sign, see Evidence; the phone wallet's agent signs only calls to a user's own limited contract, and none has been sent yet); the token-id extraction from JustHoot's launch logs; and the exact response shape of NEAR AI's image endpoint (we send the OpenAI-compatible `/v1/images/generations` request and accept `b64_json` or `url`; on failure the desk draws a placeholder coin and says so). The storage-cost view does not validate everything `create_meme` checks, so the first real launch is the true test of an empty `reference`/`reference_hash` and of `team_allocation`. `demo:check` uses the mock model, so it proves the tools, rules and pages, not the real model's choices.

## Honest limitations

- Without `PINATA_JWT`, launches go out with an empty metadata reference: the description and links live on our launch page, not on meme.cooking.
- The existing-ticker check uses meme.cooking's mainnet indexer (`api.meme.cooking`), which is where impersonation matters; the testnet site may differ. Offline, the check falls back to the blocked list only.
- No barge-in on WhatsApp calls. The browser call uses a simple energy voice detector.
- Attestation does not compare TD measurements to a published NEAR AI build (see above). Logo generation and speech-to-text have no per-response signature check (NEAR AI signs chat completions).
- Funding a launch from another chain arrives as wNEAR and needs unwrapping before signing; 1Click has no testnet.
- Storage is one JSON file. Photos are stored in `data/photos/` on this server only.

## Hackathon disclosures

- **Window (Q-001, Q-003)**: the repository's first commit is 2026-11-07 (`a23758a`), inside the hackathon window (2026-10-19 to 2026-11-14). All code in this repository was written in the window; there is no pre-hackathon baseline.
- **Other chains (Q-002)**: none; this is a NEAR-only project.
- **Other projects (Q-015)**: none to disclose.
- **Libraries (Q-005)**: TanStack Start / Router, React, Vite, TypeScript, tsx; `ws` (WebSocket); `werift` and `opusscript` (WebRTC and Opus for WhatsApp calls); `kokoro-js` (local text-to-speech); `ethers` (ECDSA signature recovery for NEAR AI replies); `@phala/dcap-qvl` (Intel TDX quote verification); `@near-wallet-selector/*` (core, modal-ui, Meteor, HOT, Intear, MyNearWallet; the HERE package is installed but not offered); `sharp` (logo resizing); `qrcode`; `yaml`; `@fontsource` fonts. External services: NEAR AI Cloud, NEAR RPC, meme.cooking indexer, JustHoot contract, NEAR Intents 1Click, Intel PCS, NVIDIA NRAS, WhatsApp Cloud API. Code was written with AI assistance (Claude Code).

## Credits

Typefaces, SIL Open Font Licence, from `@fontsource`: **Archivo Black** and **Hanken Grotesk**. The coin on the landing page and the placeholder logos are drawn in code.

Photographs (business desk):

- "End of terrace house, Elwood Street, Highbury, London N5" by Jim Osley, CC BY-SA 2.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=105321989
- "Black Claw Hammer on Brown Wooden Plank" by Homedust, CC BY 2.0, Flickr: https://www.flickr.com/photos/159630537@N08/28918563378
- "GOC Hampstead 107 Kenwood House (scaffolded)" by Peter O'Connor, CC BY-SA 2.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=106415915
- "Mozart Terrace, Ebury Road, London" by Oosoom, CC BY-SA 3.0, Wikimedia Commons: https://commons.wikimedia.org/w/index.php?curid=3581977

## Licence

MIT, see `LICENSE`. The photographs keep their own licences.
