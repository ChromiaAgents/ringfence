# Ringfence

**Call to pay. A NEAR contract you own caps what the AI can spend.** Your phone number is a NEAR wallet. Call it from WhatsApp or the browser, say "send 0.1 NEAR to liho.near", hear it read back, confirm with a spoken PIN (larger sends: an Approve tap on WhatsApp), and it's sent, but only within the limits in your contract.

> **Status: nothing has been signed on chain yet.** The links will go in [Evidence](#evidence-on-chain) as soon as the first mainnet transfers exist. Until then this is a tested design with a dry run you can check yourself (`npm run demo:check`, no keys needed).

**Worst case, even if we (the operator) are malicious:** 3 NEAR a day (the mainnet default), only to recipients you saved, and you can end it with one `revoke_agent` transaction.

**The strongest idea here:** the AI only asks; the contract you own decides. It checks the amount against your per-transfer and daily limits and the recipient against your saved list, and a new recipient always needs your own signature.

**Problem.** Most people can make a phone call but can't use a crypto wallet. They'd need to manage a recovery phrase, buy fee tokens for each chain, copy long addresses and fill in forms. A voice agent could do it for them, but then two things go wrong. The agent can be talked into sending more than it should, and the caller's voice and photos go to an AI provider.

**Product.** Ringfence is one phone line (browser call, or WhatsApp call or text). You bind your NEAR account to your number once, signing with your own wallet. On a call you can send NEAR and check your balance.

**NEAR only, for now.** The code also has EVM sends through NEAR Chain Signatures (Base and other Ethereum-style chains), but they are off unless the server sets `EVM_ENABLED=1`; with it off the wallet desk answers "Only NEAR transfers for now" and the site and bind page don't show them. The EVM sections below describe that code, not the pitch.

**What each NEAR part does:**

- **A NEAR smart contract you own** holds the wallet and enforces the limits: per transfer and per day for each asset, a list of allowed chains, a list of saved recipients with a 600-second wait for new ones, and owner-only withdraw and revoke. The AI can only ask; the contract decides.
- **NEAR Chain Signatures** (built, off by default behind `EVM_ENABLED`) lets that contract sign Ethereum-style transactions. Not advertised for now.
- **NEAR AI Cloud** runs all three AI models (chat, speech-to-text, logos) in sealed hardware (trusted execution environments, or TEEs), so the operator can't read what goes into them. The `/proof` page checks the hardware's signed proof live.
- **NEAR Intents 1Click** (optional, mainnet): "fund this launch from another chain" on the launch page.
- **JustHoot** (also works for: coin launches) is an existing NEAR launchpad. Ringfence adds voice to it; the caller signs in their own wallet.

## What you can do by voice

| Say | What happens | Who signs |
| --- | --- | --- |
| "Send 0.1 NEAR to liho.near" | Read back; up to `SMALL_LIMIT` (0.2 NEAR) you say your 4-digit PIN, above it (within limits) you tap Approve on WhatsApp; then `transfer_near` on your phone-wallet contract. To a recipient you haven't saved, the agent doesn't send: you get a link to sign it in your own wallet. The contract's 600 s queue is the backstop if the agent key ever asks for a new recipient directly | The agent key, inside your contract's limits |
| "What's my balance?" | `get_balance` on your phone wallet | Nobody (read only) |

Over a limit, or to a recipient not on your saved list: the agent says so and gives a link to sign it yourself instead.

**Also works for** (same line, same limits on the AI): a voice front end to the JustHoot coin launchpad ("Launch a coin called Sleepy Otter, ticker ZZZ": rules in code, then a page you sign in your own wallet).

**Not offered: building quotes.** Asked for a quote, the AI itself politely declines; there are no building tools. It also tells callers it can't use photos.

## Trust model

- **The contract sets the limits. The AI can't change them.** Limits, chains and recipients are checked in `contracts/phone-wallet/src/lib.rs`. A confused or tricked model can at most ask for transfers inside your limits, to your saved recipients, after a correct PIN.
- **The operator can spend without the PIN.** The server holds the agent key. The PIN protects against someone else calling from a spoofed or stolen line, not against us. Your cap on that is the daily limit per asset; `revoke_agent` ends it, and `withdraw` always works. Or hold the agent key yourself: [SELF-HOST.md](SELF-HOST.md).
- **Your phone number is not the security.** Binding is signed by the NEAR account owner. Against a SIM swap or a spoofed caller ID, what protects you is only the PIN plus the caps. The PIN is 4 digits; 3 wrong tries lock it for 15 minutes, so trying every PIN takes about 35 days, during which at most the daily cap could move.
- **The PIN passes through the AI.** Speech-to-text and the language model hear it, inside NEAR AI TEEs. It is stored only in scrambled form (a salted hash) and blanked from the stored transcript and tool log.
- **The contract is unaudited.** Keep small amounts in it. Mainnet defaults: 0.2 NEAR per transfer and 0.5 per day; 600 s wait for new recipients.
- **Known privacy limits.** Reply text goes to Cartesia when Cartesia is the voice (not a TEE); `TTS_PROVIDER=kokoro` keeps it on the box. This app server itself is not attested, so transcripts and the PIN path pass through an ordinary server. On WhatsApp, Meta carries the call and sees its metadata.
- **Nothing has been signed on chain yet.** See [Evidence](#evidence-on-chain).

## Run it with no keys in 2 minutes

Node 22+. No `.env`, no API key, no wallet, no network needed for the steps marked offline.

```bash
npm ci
npm test              # 28 tests, offline except the address derivation check
npm run typecheck
npm run build
npm run demo:check    # offline: starts the built server with MOCK_LLM=1 and no .env, walks a launch, a declined building quote, a wallet send (DRY RUN) and a refused EVM send over the call socket, checks the pages, stops the server
```

`npm run demo:check` prints one line per step. Expected output:

```
PASS  server starts with MOCK_LLM=1, no .env, no key  (port …)
PASS  launch desk: refuses ticker NEAR, then prepares a launch over the call socket  (http://localhost:…/launch/…)
PASS  launch page renders (/launch/:id) with the agreed terms  ($ZZOTR on justhoot (mainnet), prepared, logo: drawn locally; nothing signed)
PASS  out of scope: the AI declines a building quote (no canned line, no business tools)  (I can send NEAR for you, or help you launch a coin.)
PASS  the AI ends the call: "thanks, bye" -> goodbye, end_call, hangup event to the page  (Bye!)
PASS  ledger records the refusal and the launch  (4 entries)
PASS  wallet desk: send 0.1 NEAR to liho.testnet, read back, PIN, dry run (no agent key)  (stopped before signing: DRY RUN)
PASS  wallet desk: 0.3 NEAR asks for the WhatsApp Approve tap; a simulated button reply executes it (dry run)
PASS  custodial create in WhatsApp chat: no custody key -> labelled dry run, PIN not stored
PASS  wallet desk: "how much did I spend?" lists recent transfers
PASS  /wallet/claim page renders
PASS  wallet desk: an EVM send is refused politely (EVM_ENABLED off)
PASS  /wallet/bind page renders
PASS  dashboard and /proof pages render
```

To click through it yourself: `MOCK_LLM=1 npm start` (add `TTS=off` to skip downloading the local Kokoro voice, about 90 MB), open `http://localhost:8787`, press **Call**, and type into the call box. In mock mode the model is replaced by a small keyword script (`mockStep` in `src/ai.ts`) that makes the same tool calls a model would; the tools, rules, pages and ledger are the real ones. Type these lines:

| Desk | Type | You should see |
| --- | --- | --- |
| Wallet | `send 0.1 NEAR to liho.testnet`, then a 4-digit PIN | Read back, then a result clearly labelled **DRY RUN** (no agent key set, nothing is signed) |
| Launch | `Call it Sleepy Otter, ticker NEAR` | "Sorry, I can't do that: NEAR is the ticker of an existing asset" (refused in `checkTicker`), logged as Refused on `/dashboard` |
| Launch | `Call it Sleepy Otter, ticker ZZOTR` | Accepted |
| Launch | `Logo vibe: a sleepy otter on a pillow` | Without a key the image model is skipped and a placeholder coin is drawn locally (the page says so) |
| Launch | `One hour, soft cap 100 NEAR` | Refused on JustHoot (no auction there). Auction and team rules (`checkAuction`, `checkTeam`, max 10% team) apply on meme.cooking, which is off by default |
| Launch | `Yes, set it up` | **Open your launch** box. The page shows the terms and, after **Connect a wallet**, the exact NEAR cost from JustHoot's mainnet views (needs network) |
| Let it ask | `I need a new kitchen` | "Sorry, we don't do building quotes or bookings…" (not offered; no desk opens) |

With network but still no key: `npm run attest` verifies the TEE attestation of all three models (below), and `npm run test:meme` / `npm run test:justhoot` call the meme.cooking and JustHoot view methods.

## Feature → where in the code → how to verify

| Feature | Code | Verify |
| --- | --- | --- |
| Phone wallet contract: per-transfer and per-day limits per asset, EVM chain allowlist, recipient allowlist, 600 s delay for new recipients, owner-only `withdraw` / `revoke_agent` / `set_agent`, agent never the owner | `contracts/phone-wallet/src/lib.rs` | Contract unit tests (23) and the near-workspaces sandbox test; read `lib.rs` |
| Contract parses the unsigned EIP-1559 bytes (chain id, to, value) before asking the MPC signer | `lib.rs` `parse_eip1559`; `src/eth.ts` `buildTransfer` | Contract tests (RLP, chain id mismatch, Base vector); `npm test` (Sepolia and Base bytes match the contract's vectors) |
| Same EVM address on every EVM chain through Chain Signatures, derived as NEAR's MPC does | `src/eth.ts` `deriveEthAddress`; `src/chains.ts` | `npm test` (compares with live `derived_public_key` views of `v1.signer` and `v1.signer-prod.testnet`) |
| Gas checked before signing; says how much is missing and where to fund | `src/eth.ts` `prepareTransfer`, `GasShortError` | `npm test` (mocked RPC) |
| Voice send: read back, spoken PIN (salted scrypt hash, 3 tries then 15 min lock, blanked from transcript and tool log) | `src/desks/wallet.ts`; `src/wallet.ts` `hashPin`, `checkPin`, `normalizePin` | `npm test`; `npm run demo:check` (wallet step, DRY RUN) |
| Real NEAR and Base transfers with the agent key | `src/wallet.ts` `sendNear`, `sendEvm`; `app/routes/wallet.bind.tsx`, `app/routes/wallet.send.tsx` | Needs `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY`, `NETWORK=mainnet`, a bound number. Not run live yet |
| Ticker/name impersonation refused (blocked list, existing meme.cooking tickers) | `src/desks/launch.ts` `checkTicker`, `checkName`; `launchpad.yaml` | `npm test` (ticker impersonation, name impersonation); `npm run demo:check` step 2 |
| Auction bounds, team allocation cap with cliff and vesting | `checkAuction`, `checkTeam` | `npm test` (auction bounds, team allocation) |
| No promised returns: replies filtered sentence by sentence before they are spoken | `filterClaims`, `src/speech.ts` `sentenceSplitter` | `npm test` (no promised returns, streamed sentences + per-sentence filter) |
| All rules re-checked at the last step; kill switch | `prepare_launch` in `src/desks/launch.ts` | `npm test` (justhoot prepare_launch); set `kill_switch: true` in `launchpad.yaml` and walk the demo |
| meme.cooking `create_meme` transaction, signed by the caller (built, off by default; JustHoot is the launchpad in use) | `src/memecook.ts` `createMemeArgs`, `buildTx`, `confirmTx`; `app/routes/launch.$id.tsx` | `npm test` (create_meme args); `npm run test:meme` (testnet view) / `npm run test:meme mainnet` |
| JustHoot `launch_meme` (token + RHEA pool in one call), cost from the contract's views | `src/justhoot.ts` | `npm test` (justhoot args, justhoot prepare_launch); `npm run test:justhoot` (mainnet views) |
| Wallet Selector: Meteor, HOT, Intear, MyNearWallet; server never signs | `app/routes/launch.$id.tsx` | Open a launch page, **Connect a wallet** |
| One agent (all tools, dispatch to desk code, end_call) and returning-caller memory | `src/agent.ts` `toolsFor` / `deskOfTool`; `src/memory.ts` | `npm test` (one agent, returning caller) |
| TEE attestation: Intel TDX quote signature + TCB status, key+nonce in report_data, NVIDIA GPUs via NRAS | `src/ai.ts` `attest`, `verifyIntelQuote`, `verifyGpu` | `npm run attest` (no key); `/proof`; `/api/proof?fresh=1` |
| Every chat reply's signature recovered and matched to the attested key (built; live check pending) | `src/ai.ts` `chat`, `verifyLater` | Needs `NEARAI_API_KEY`: call, then see **TEE-signed** badges on `/dashboard` |
| Voice: TTS (Cartesia Sonic in the cloud, or local Kokoro), Whisper STT in a TEE, barge-in, fillers | `src/tts.ts`, `src/turn.ts`, `src/voice.ts` | `MOCK_LLM=1 npm run test:latency`; a browser call |
| WhatsApp calls (WebRTC/Opus), text (photos get a polite "can't use photos") | `src/whatsapp.ts` | Needs Meta test number, see [WhatsApp setup](#whatsapp-setup-metas-free-test-number) |
| Ledger of every refusal, filter hit, launch and wallet action | `src/store.ts` `log`; `/dashboard` | `npm run demo:check` step 6 |

## Tracks and the hints each feature uses

- **Security**: wallet limits enforced by a NEAR contract, not by the AI (per-asset limits, chain and recipient allowlists, new-recipient delay, owner-only withdraw and revoke, agent never the owner); the contract parses the EVM transaction bytes itself before the MPC signer signs; spoken PIN stored as a salted hash with lockout; attestation verified rather than trusted; per-reply signature checks; owner pages behind basic auth (`DASHBOARD_PASSWORD`). Honest gap: the contract is unaudited, and the operator holding the agent key can spend inside your limits without the PIN.
- **Agents**: tool-calling desks on one runtime (wallet, launch), each a config file + prompt + tools; rules enforced in tool code, not in the prompt; the agent acts on chain by calling the owner's own limited contract.
- **Real world**: a phone call is the interface, so someone without a wallet app can send money by voice; WhatsApp calls and texts.
- **Privacy**: NEAR AI Cloud private inference for every model (chat, STT, image), with attestation verified in this process (Intel TDX + NVIDIA NRAS) and signed chat replies; the spoken PIN is heard only inside TEEs and blanked from storage; text-to-speech is either Cartesia (cloud: the reply text goes to Cartesia, a third party, not a TEE) or local Kokoro (`TTS_PROVIDER=kokoro`: the text never leaves the box).
- **Memecoins**: launching on JustHoot (token plus RHEA pool in one `launch_meme` call, mainnet) by voice, signed in the caller's own wallet, with impersonation blocks, a no-promised-returns filter and a kill switch in code. The memecoin mechanic itself is thin: it is a voice front end to an existing launchpad, not a new launch design. meme.cooking support is built but off by default.

## Phone wallet: your phone number is a NEAR wallet

> **Unaudited prototype: keep small amounts.** The phone-wallet contract has not been audited. On mainnet it moves real money; the defaults are deliberately small.

Bind your NEAR account (`.near` on mainnet, `.testnet` on testnet, per `NETWORK`) to your WhatsApp number once on `/wallet/bind`. Then on a call: "send 0.5 NEAR to liho.near", hear it read back ("1 NEAR to bob dot near"), say your 4-digit PIN, and it executes on chain within limits a smart contract enforces, not the AI. The nearblocks link arrives on WhatsApp. (With `EVM_ENABLED=1` the same flow also takes "send 0.0001 ETH on Base to 0x…"; off by default.)

**How it works**

1. `/wallet/bind`: connect your NEAR wallet (or follow "No wallet? Create one in Meteor"), get a 6-digit code on WhatsApp, set a PIN (stored only as a salted scrypt hash), edit the limits, then sign one plain function call: `create_wallet(phone_hash, owner = you, agent, near_limit, new_recipient_delay_sec)` on the factory (`FACTORY_ACCOUNT_ID`, ringfence-wallet.near), attaching 0.013 NEAR. It creates `<12 hex>.ringfence-wallet.near` on the phone-wallet global contract. Works in any wallet, including implicit accounts. **Guardian option**: "Set up for someone else" makes your wallet the owner and your family member's WhatsApp the phone; the code goes to their phone and they read it out. Nothing runs until you sign.
   - **No wallet at all (built, dry run until keys are set):** text "create a wallet" to the WhatsApp number. The agent explains it's a demo custodial wallet (capped, unaudited), you reply with a 4-digit PIN (answered outside the agent, never logged), and the server calls `create_wallet` with owner = `CUSTODY_ACCOUNT_ID`. Without `CUSTODY_PRIVATE_KEY` this is a labelled DRY RUN. Caps: spends stop above `CUSTODIAL_MAX_NEAR` (5) NEAR, at most `CUSTODIAL_DAILY_CAP` (20) wallets a day.
   - **Claim (built, not run on chain):** `/wallet/claim`: connect your wallet, verify a WhatsApp code to the bound number; custody calls `propose_owner(you)`, you sign `accept_owner`. After that the server marks the wallet non-custodial and never uses the custody key on it.
2. On a call the agent uses the **wallet tools** (`src/desks/wallet.ts`) when the caller wants to pay: `get_balance`, `prepare_transfer({to, amount, asset})` (reads back), `confirm_transfer({pin})`. `asset` is `near` or a chain name (`base`, `ethereum`, `arbitrum`, `optimism`, `polygon`, `bnb`, `avalanche`); plain "ETH" gets "which chain?". The PIN is checked against the hash; 3 wrong tries lock it for 15 minutes; the PIN is blanked from the stored transcript and the tool log.
3. With the PIN right, the server calls your contract with the agent key (`near-api-js`): `transfer_near` for NEAR, `request_signature` for EVM chains.
4. **Confirmation tiers (built, tested offline):** up to `SMALL_LIMIT` (0.2 NEAR) to a saved recipient: spoken PIN. Larger, still within limits: a WhatsApp interactive message with [Approve] [Reject] goes to the wallet's bound phone (amount, recipient, daily limit left; single use, expires in 120 s), also for browser calls; on Approve the server executes and the agent on the call says so. Reject pauses all spends from that wallet on the server for 15 minutes (owner-only `freeze` is not available to the agent key) and, for a custodial wallet, also calls `freeze` on chain with the custody key. Over a limit or to a new recipient: the agent texts a link (`/wallet/send`) to sign it in your own wallet. With the default 0.2 NEAR per-transfer limit, the Approve tier only appears once the owner raises it.
5. "How much did I spend?": today's spend vs the daily limit from the contract, and the last 5 transfers from the ledger.
6. A number with no wallet gets the choice: a demo custodial wallet in chat, or `/wallet/bind`.

**EVM chains through Chain Signatures (built, off unless `EVM_ENABLED=1`).** One MPC path (`ethereum-1`) gives your contract **the same EVM address on every EVM chain**; you fund gas on whichever chain you want to use. The address is derived as NEAR's MPC does (`src/eth.ts`; checked in `npm test` against the live `derived_public_key` views of both `v1.signer` (mainnet) and `v1.signer-prod.testnet`). Chains come from a small registry (`src/chains.ts`: Ethereum 1, Base 8453, Arbitrum 42161, Optimism 10, Polygon 137, BNB Chain 56, Avalanche 43114, plus Sepolia; more with `EXTRA_CHAINS`, RPCs overridable with `RPC_<chainId>`). The server builds an EIP-1559 transfer (nonce and fees from the chain's public RPC) and **checks gas first**: if the address holds less than value + maxFee × 21000, it says how much is missing and which address to fund, and no signature is requested. The contract parses the unsigned transaction itself (minimal RLP: the chain id must be on the owner's chain allowlist and match `evm:<chainId>`, `to` an address, no calldata, no access list), applies that chain's limits to the value it parsed, and calls `sign({request: {path, payload_v2: {Ecdsa: keccak256(tx)}, domain_id: 0}})` on the MPC signer with 1 yoctoNEAR. The signature comes back as the call's result; the server attaches it and broadcasts to that chain.

**Which chains are on (only with `EVM_ENABLED=1`).** Mainnet: **Base** is enabled at bind with small limits. The other registry chains are known to the server but the contract refuses them until the owner allows them, with their own limits in that chain's native units (wei for ETH, BNB, POL, AVAX):

```bash
near contract call-function as-transaction phone.you.near allow_chain json-args '{"chain_id":42161,"per_tx":"500000000000000","per_day":"2000000000000000"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send
```

Next: non-EVM chains (Bitcoin, Solana through the same MPC signer's other domains) are not supported yet.

**Trust model and limits.** The contract is the only thing that can move funds, and it checks every agent call. **It is an unaudited prototype: keep small amounts in it.**

| Rule | Enforced in `contracts/phone-wallet/src/lib.rs` |
| --- | --- |
| Per transfer and per day, per asset (`near`, `evm:<chainId>`) | Mainnet defaults 1 / 3 NEAR and 0.0005 / 0.002 per EVM chain (native units); editable on the bind page before signing; owner changes later with `set_limits`. Over → panic with the reason |
| EVM chains on an owner allowlist | `allow_chain(chain_id, per_tx, per_day)` / `disallow_chain`; a chain not allowed, or without a limit, is refused; the tx's chain id must match |
| Saved recipients go instantly; new ones queue (the voice agent hands them to you to self-sign instead) | `new_recipient_delay_sec` = 600; `execute(id)` after the delay, owner `cancel(id)` before |
| Owner keeps full control | `withdraw(amount)` always works (the agent can't block it), `set_agent`, `revoke_agent`, `allow`/`disallow`, `allow_chain`/`disallow_chain`, `set_delay`; all need 1 yoctoNEAR so a dapp's function-call key can't call them |
| The agent is never the owner | checked at init and in `set_agent` |
| EVM chain, value and recipient are the ones signed | parsed from the transaction bytes the contract hashes and sends to the signer |
| A phone can't borrow someone else's contract | the owner signs `phone_hash` at init; the server checks it before every call |

What the AI can do if it goes wrong: ask the contract for transfers inside your limits to your saved recipients after a correct PIN. What the server operator could do with the agent key: the same, without the PIN (the PIN protects against someone else calling from a spoofed or stolen line, not against us). Your cap on that is the daily limit per asset; `revoke_agent` ends it.

**Verified and not.** Verified locally: 23 contract unit tests (limits, mainnet defaults, day rollover with mocked time, allowlist vs delay queue, cancel, owner-only methods, revoke, RLP parsing, chain allowlist, chain id mismatch, chain without limit, Base tx vector) and a near-workspaces sandbox test (real transfers, the delay with fast-forward, owner withdraw while the agent is set, agent locked out of owner methods and after revoke, `request_signature` for Sepolia and Base routed to a mock MPC signer with the wallet as predecessor and the right request shape, a non-allowed chain refused); `npm test` (PIN normalization, lockout, intent → tool args incl. "on Base", chain registry, ETH derivation against the live mainnet and testnet MPC views, Sepolia and Base EIP-1559 bytes identical to the contract's test vectors, the gas-check refusal with a mocked RPC, signature assembly); `demo:check` walks "send 1 NEAR to liho.testnet" + PIN to a clearly labelled **DRY RUN**. Not verified: nothing has been deployed or sent on mainnet, testnet, Base or Sepolia; the real MPC signer's response going through `getTransactionLastResult`; which wallets accept the create + deploy + init transaction on `/wallet/bind` (CLI fallback in HANDOVER.md); a queued EVM transfer can go stale (its nonce and fees are fixed when queued); the public RPCs' rate limits. `ft_transfer` and ERC-20s are not implemented.

`AGENT_ACCOUNT_ID` / `AGENT_PRIVATE_KEY` turn it on; without them it is a dry run.

## Coin launch: JustHoot

The launch desk supports two launchpads; the caller picks one or the agent suggests one (`set_launchpad`):

- **meme.cooking**: a fair-launch auction first, about 0.22 NEAR. Testnet or mainnet per `NETWORK`. Off by default (`meme_cooking.enabled: false` in `launchpad.yaml`).
- **JustHoot** ([justhoot.fun](https://justhoot.fun)): one `launch_meme` call on `v2-launchpad.justhoot.near` creates the token and its RHEA DCL pool (1% fee tier), tradable immediately. **Mainnet only, real NEAR** (there is no testnet deployment), about 0.06 NEAR plus the on-chain logo's storage (about 0.1 NEAR with a 4 KB logo). Deposit and gas come from the contract's `get_launch_deposit` and `get_launch_gas` views; if the signer has no storage on the launchpad, `storage_deposit` goes first in the same transaction. No transfer tax and no dev buy are offered; all supply goes to the creator and the pool. `set_auction` and `set_team_allocation` refuse on JustHoot; tickers are 1 to 10 letters or digits and are not unique there, so the meme.cooking collision check is skipped. All other rules (blocked tickers and names, return-promise filter, kill switch) still apply. Turn it off with `launchpads.justhoot.enabled: false` in `launchpad.yaml`.
- After a JustHoot launch the page links "Give your coin a brain" to [NEARON](https://stg.nearon.dev/#/docs) (stake NEAR, earn CREDIT, bind the coin so its AI agent is paid for). NEARON is a testnet staging prototype today; this is a link only.

Code: `src/justhoot.ts`. Live view-only check: `npm run test:justhoot`. Not verified: no real JustHoot launch has been signed, and the token-id extraction from the launch logs is untested (the page always links the transaction and justhoot.fun).

## Try it with keys (full voice demo)

With `NEARAI_API_KEY` set (see [Run it with keys](#run-it-with-keys)), open `http://localhost:8787`. No mic? Press **Call** and type.

### Wallet desk

Bind first on `/wallet/bind` (see [Phone wallet](#phone-wallet-your-phone-number-is-a-near-wallet)). Then call and say "send 0.1 NEAR to liho.near", listen to the read back, and say your PIN. Without `AGENT_ACCOUNT_ID` and `AGENT_PRIVATE_KEY` the result is a labelled DRY RUN.

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

### Building quotes: not offered

Say "I need a new kitchen" on the line: the AI answers that building quotes are not offered; it has no building tools.

`/dashboard` shows both desks: calls with a **TEE-signed** badge on each verified reply, launches (prepared, live, failed), the ledger of every refusal and action, the rules, and the verified attestation of all three models. `/proof` shows the same attestation publicly, with every check.

## TEE attestation, in detail

`npm run attest` (network only, no key) fetches `https://cloud-api.near.ai/v1/attestation/report` for each model with a fresh 32-byte nonce and checks:

1. **Intel TDX quote**: signature, QE report and PCK certificate chain up to Intel's SGX root CA, with collateral (TCB info, QE identity, CRLs) fetched from Intel PCS (`api.trustedservices.intel.com`), using [`@phala/dcap-qvl`](https://github.com/Phala-Network/dcap-qvl) (pure JS). Prints the TCB status (for example `UpToDate`) and any advisory IDs. A quote with one flipped byte is rejected ("ISV enclave report signature is invalid").
2. **report_data** (read from the verified quote) equals the model's signing address, zero-padded to 32 bytes, followed by our nonce.
3. **NVIDIA GPUs**: `nvidia_payload` (8 × H100 evidence carrying our nonce) is posted to NVIDIA NRAS `/v3/attest/gpu`; the returned platform and per-GPU JWTs are verified (ES384) against NVIDIA's JWKS, and the overall result, each GPU's measurement result and nonce match must be true.

Output on 2026-11-08 (abridged): every model `PASS` on all three checks, TCB `UpToDate`, `8 x HOPPER`, all models fully verified (that run also covered a photo-reading model that has since been removed). The same results are on `/proof` (public) and `/dashboard`, and chat replies only get the **TEE-signed** badge when their signer is a key that passed checks 1 and 2.

Not checked: that the TD measurements (MRTD, RTMR0-3) and the event log match a published, reproducible NEAR AI image, and the `gateway_attestation` of NEAR AI's gateway. For those, follow [docs.near.ai/cloud/verification](https://docs.near.ai/cloud/verification/).

## NEAR tech used

- **Phone-wallet contract on NEAR** (`contracts/phone-wallet`): one contract per user, owned by the user, with the agent key allowed only inside its limits.
- **NEAR Chain Signatures** (`src/eth.ts`, `lib.rs` `request_signature`): the contract calls `sign` on `v1.signer` (mainnet) or `v1.signer-prod.testnet` with path `ethereum-1`, giving one EVM address on every EVM chain.
- **NEAR AI Cloud, private inference** (`src/ai.ts`, `src/image.ts`). Chat `Qwen/Qwen3.6-35B-A3B-FP8`, speech-to-text `openai/whisper-large-v3`, logos `black-forest-labs/FLUX.2-klein-4B`, all `owned_by: nearai` (Intel TDX + NVIDIA confidential GPUs). For each model we fetch the attestation report with a fresh nonce and verify the Intel TDX quote, the key and nonce in its report data, and the NVIDIA GPU evidence (see [TEE attestation, in detail](#tee-attestation-in-detail)). Every chat reply's signature is fetched and verified (ECDSA recover) against that key.
- **meme.cooking on NEAR** (`src/memecook.ts`). Mainnet `meme-cooking.near`; testnet `factory.v10.meme-cooking.testnet` (the address in meme.cooking's developer docs; it whitelists `wrap.testnet`). One transaction: `storage_deposit` (only if `storage_balance_of` is null; deposit = `storage_costs.account`) + `create_meme` (250 Tgas, deposit = `create_meme_storage_cost`), arguments in the shape of the contract's published ABI. After signing, the server reads the transaction with `EXPERIMENTAL_tx_status` and takes the meme id from the `create_meme` event or the return value.
- **NEAR Wallet Selector** (`app/routes/launch.$id.tsx`, `/wallet/bind`, `/wallet/send`): Meteor, HOT, Intear, MyNearWallet on the configured network. Launches and over-limit sends are signed by the caller. The server holds one key, the phone wallet's agent key, which can only call the user's own limited contract.
- **NEAR Intents 1Click** (`src/fund.ts`): optionally and on mainnet only, "fund this launch from another chain" (an `EXACT_OUTPUT` swap): exactly the launch cost delivered to your NEAR account as wNEAR.
- **WhatsApp Cloud API calling** (`src/whatsapp.ts`): calls over WebRTC (werift + Opus), and text messages.

## Run it with keys

```bash
npm ci
cp .env.example .env      # at least NEARAI_API_KEY; NETWORK=testnet by default
npm run dev               # http://localhost:8787  (UI + voice + webhooks, one port)
```

Production: `npm run build && npm start`, or on a VPS with Docker/systemd + Caddy: `deploy/README.md`. Run your own operator (your agent key, your WhatsApp number) in about 15 minutes: [SELF-HOST.md](SELF-HOST.md). Demo data: `npm run seed`, then `DB_FILE=data/demo-db.json npm run dev`.

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
| `NETWORK` | `testnet` (default) or `mainnet` for launches and the phone wallet |
| `EVM_ENABLED` | Off by default. `1` turns on EVM sends through Chain Signatures (Base on mainnet, Sepolia on testnet); off, the wallet desk says "Only NEAR transfers for now" |
| `PUBLIC_URL` | Public URL of this server, used in launch and wallet links |
| `PINATA_JWT` | Optional. Pins the coin's description and links to IPFS (the reference meme.cooking's app uses) |
| `ONECLICK_JWT` | Optional 1Click partner JWT for launch funding (without it 1Click adds a 0.2% fee) |
| `DASHBOARD_PASSWORD` | Optional basic auth on `/dashboard`, `/api/state` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API |

### WhatsApp setup (Meta's free test number)

1. Create an app at developers.facebook.com (type Business), add **WhatsApp**, add your phone as a test recipient.
2. Copy the access token to `WHATSAPP_TOKEN`, the phone number ID to `WHATSAPP_PHONE_NUMBER_ID`, the app secret to `WHATSAPP_APP_SECRET`; pick any `WHATSAPP_VERIFY_TOKEN`.
3. Expose the server (`cloudflared tunnel --url http://localhost:8787`) and set `PUBLIC_URL`.
4. Set the webhook to `<PUBLIC_URL>/webhooks/whatsapp`, subscribe to **messages** and **calls**.
5. In WhatsApp Manager, your number, **Call settings**, allow voice calls.
6. Call or message the number: "I want to launch a memecoin" or "send 0.1 NEAR to alice.testnet".

## How it is built

- `contracts/phone-wallet`: the NEAR contract that holds the wallet and enforces limits.
- `src/desks/wallet.ts`, `src/wallet.ts`, `src/eth.ts`, `src/chains.ts`: the wallet desk, PIN handling, agent calls, EVM transaction building, address derivation, chain registry.
- `src/agent.ts`: one agent, Ringfence. One system prompt; the AI decides every reply and action. Its tools are the wallet and launch tools and `end_call`, each dispatched to the desk module that owns it (the desks are tool providers: PIN, limits, approvals, launch checks and the no-promised-returns filter stay in their code). Only the opening greeting is fixed text. The AI hangs up itself with `end_call` (WhatsApp terminates after the goodbye plays; the browser page gets a `hangup` event). Also: tool loop, output filter on every sentence, link hook.
- `src/desks/launch.ts` + `launchpad.yaml`: launch rules (`checkTicker`, `checkName`, `checkAuction`, `checkTeam`, `filterClaims`), all re-checked at `prepare_launch`, kill switch.
- `src/justhoot.ts`: JustHoot's `launch_meme` args, cost from its views, the transaction, and the after-the-fact check.
- `src/memecook.ts`: RPC views, `createMemeArgs`, `launchCost`, `buildTx`, `confirmTx`, and the meme.cooking indexer for existing tickers.
- `src/ai.ts`: NEAR AI Cloud chat and STT, per-reply signature checks, the attestation verifier (Intel TDX + NVIDIA NRAS), and the `MOCK_LLM` script.
- `app/`: TanStack Start UI: `/`, `/launch/$id`, `/wallet/*`, `/dashboard`, `/proof`, and the `/api/*` routes.
- `scripts/demo-check.ts`, `scripts/attest.ts`: the headless no-key smoke test and the attestation report.
- `server.ts`: one Node process on one port: Vite middleware in dev, the built handler in prod, the voice WebSocket and WhatsApp webhook on the same server.

## Evidence (on-chain)

To be filled after the team runs them; none of these has been done by this code's authors yet.

| What | Link |
| --- | --- |
| meme.cooking launch on testnet, signed through `/launch/:id` | TODO: testnet explorer link to the `create_meme` transaction |
| JustHoot launch on mainnet, signed through `/launch/:id` | TODO: nearblocks link to the `launch_meme` transaction |
| Phone wallet: create + deploy + init `phone.<you>.near` through `/wallet/bind` | TODO: nearblocks.io link |
| Phone wallet: a NEAR transfer by voice + PIN (`transfer_near`) | TODO: nearblocks.io link |
| Demo video and X post | TODO |

## Verified, and not

Verified here (2026-11-08): `npm test` 28 passed; `npm run typecheck` and `npm run build` pass; `npm run demo:check` all 9 steps pass with no `.env` (re-run 2026-11-08 after the NEAR-only, no-builder change); `npm run attest` verified every model at the time (since cut to three) (Intel TDX quote, TCB `UpToDate`, key+nonce binding, 8 NVIDIA H100 GPUs through NRAS); `create_meme_storage_cost` accepts our arguments on testnet and mainnet (`npm run test:meme`); the testnet contract whitelists `wrap.testnet`; the meme.cooking indexer is reachable; dry 1Click quotes returned for Base USDC, Solana SOL and wNEAR (that script, `test:quote`, has since been removed with the builder desk).

Not verified here: a real signed `create_meme` or `launch_meme` and a real 1Click launch-funding swap (they need a funded wallet and a person to sign; the launch and funding paths never sign, see Evidence; the phone wallet's agent signs only calls to a user's own limited contract, and none has been sent yet); the token-id extraction from JustHoot's launch logs; and the exact response shape of NEAR AI's image endpoint (we send the OpenAI-compatible `/v1/images/generations` request and accept `b64_json` or `url`; on failure the desk draws a placeholder coin and says so). The storage-cost view does not validate everything `create_meme` checks, so the first real launch is the true test of an empty `reference`/`reference_hash` and of `team_allocation`. `demo:check` uses the mock model, so it proves the tools, rules and pages, not the real model's choices.

## Honest limitations

- The phone-wallet contract is unaudited; keep small amounts in it. The operator can spend inside your limits without the PIN. The PIN passes through speech-to-text and the LLM inside NEAR AI TEEs.
- NEAR only for now: EVM sends are built but off unless `EVM_ENABLED=1`. Bitcoin, Solana and ERC-20 tokens are not supported.
- JustHoot is mainnet only and costs real NEAR whatever `NETWORK` says. NEARON is a link only.
- `demo:check` uses a mock model: it proves the tools, rules and pages, not the real model's choices.
- Without `PINATA_JWT`, launches go out with an empty metadata reference: the description and links live on our launch page, not on meme.cooking.
- The existing-ticker check uses meme.cooking's mainnet indexer (`api.meme.cooking`), which is where impersonation matters; the testnet site may differ. Offline, the check falls back to the blocked list only.
- No barge-in on WhatsApp calls. The browser call uses a simple energy voice detector.
- Attestation does not compare TD measurements to a published NEAR AI build (see above). Logo generation and speech-to-text have no per-response signature check (NEAR AI signs chat completions).
- Funding a launch from another chain arrives as wNEAR and needs unwrapping before signing; 1Click has no testnet.
- Storage is one JSON file. Photos sent to the line are not read or stored.

## Hackathon disclosures

- **Window (Q-001, Q-003)**: the repository's first commit is 2026-11-07 (`a23758a`), inside the hackathon window (2026-10-19 to 2026-11-14). All code in this repository was written in the window; there is no pre-hackathon baseline.
- **Other chains (Q-002)**: NEAR only for now. EVM sends through NEAR Chain Signatures are built (Base on mainnet, Sepolia on testnet; others only after the owner calls `allow_chain`) but off unless `EVM_ENABLED=1`. The contract and all signing requests live on NEAR. Bitcoin and Solana are not supported.
- **Other projects (Q-015)**: none to disclose.
- **Libraries (Q-005)**: TanStack Start / Router, React, Vite, TypeScript, tsx; `ws` (WebSocket); `werift` and `opusscript` (WebRTC and Opus for WhatsApp calls); `kokoro-js` (local text-to-speech); `ethers` (ECDSA signature recovery for NEAR AI replies); `@phala/dcap-qvl` (Intel TDX quote verification); `@near-wallet-selector/*` (core, modal-ui, Meteor, HOT, Intear, MyNearWallet; the HERE package is installed but not offered); `sharp` (logo resizing); `qrcode`; `yaml`; `@fontsource` fonts. External services: NEAR AI Cloud, NEAR RPC, meme.cooking indexer, JustHoot contract, NEAR Intents 1Click, Intel PCS, NVIDIA NRAS, WhatsApp Cloud API. Code was written with AI assistance (Claude Code).

## Credits

Typefaces, SIL Open Font Licence, from `@fontsource`: **Archivo Black** and **Hanken Grotesk**. The coin on the landing page and the placeholder logos are drawn in code.

## Licence

MIT, see `LICENSE`. The photographs keep their own licences.
