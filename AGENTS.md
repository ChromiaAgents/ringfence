# AGENTS.md

Facts and commands for an agent that reads or checks this repository. README.md is the full description.

## What this is

Ringfence is a phone line for NEAR: a caller in a browser or on WhatsApp talks to one AI agent, and the agent acts from a NEAR wallet contract tied to the caller's phone number.
The wallet contract holds the spending rules (a limit per transfer, a limit per day, saved recipients, a wait for new recipients, freeze), so the agent can only ask it.
A money packet is NEAR locked in a second contract and split between people; each person opens one share by saying the packet's words on a call.
A Sputnik DAO (ringfence-family.sputnik-dao.near) funded packet family-1 on mainnet: https://ringfence.evalengine.ai/packet/family-1.
Top up from any chain through NEAR Intents 1Click: on a call, "top up my wallet with 2 dollars of SOL" gives a live quote; with a refund address the live site gives a real deposit address on screen. On the shared demo wallet the USDC goes to the demo wallet, not the caller. No swap on mainnet yet.

## Commands, in order

Node 22 or newer. Nothing below needs a key, a `.env` file or a wallet. Nothing below signs or sends a transaction.

| # | Command | Network | Rough time | Expected last line |
| --- | --- | --- | --- | --- |
| 1 | `npm ci` | yes | 15 s | `added <n> packages ...` and npm's audit summary |
| 2 | `npm test` | no | 15 s | `<n> passed` (57 on 12 Nov 2026) |
| 3 | `npm run demo:check` | no | 15 s | `all steps passed` (after 19 lines that start with `PASS`) |
| 4 | `npm run verify:contracts` | yes | 10 s | 3 blocks, each starting with `ok`; exit code 0 |
| 5 | `npm run attest` | yes | 10 s | `3/3 models fully verified`, then one line of links |
| 6 | `npm run verify:evidence` | yes | 5 s | `15 of 15 transactions match` |
| 7 | `npm run attack` | no | 2 s | `5 of 5 attacks blocked` |
| 8 | `npm run live:check` | yes | 30 to 90 s | `5 of 5 checks passed` |
| 9 | `cd contracts/phone-wallet && cargo test` | first run | 4 min first run | `test result: ok.` (38 unit tests, then 4 sandbox tests) |
| 10 | `cd contracts/factory && cargo test` | first run | 90 s first run | `test result: ok.` (10 unit tests, 1 sandbox test) |
| 11 | `cd contracts/packets && cargo test` | first run | 100 s first run | `test result: ok.` (16 unit tests, 1 sandbox test, 1 upgrade test) |
| 12 | `npm run topup:quote -- 10 SOL` | yes | 5 s | `}` closing a JSON quote with `"dry": true` (first line: whether the recipient is registered with USDC; the demo wallet is, since 12 Nov 2026) |
| 13 | `npm run dao:wallet -- family.sputnik-dao.near 15550104477` | no | 2 s | `REFUSED: WALLET_SECRET is not set. ...` and exit 1 without the secret; with it, `Nothing was signed or sent. ...` |

Notes on single commands:

- 2: one `ok` line per check, then `<n> passed`. The count grows when checks are added; any failure stops the run with an error and a non-zero exit code.
- 3: builds the site first, then starts a local server with a scripted model on a free port and stops it.
- 4: hashes the three files in `contracts/release/` and compares them with the code hashes on mainnet.
- 5: fetches the attestation of the three NEAR AI Cloud models (chat, speech-to-text, image) and checks the Intel TDX quote, the nonce and the NVIDIA GPU report.
- 6: reads the 15 transactions of the README "Mainnet evidence" table from a public archival RPC and prints signer, receiver, method and result for each, with `ok` or `DIFF`. The explorer links in the README (nearblocks.io) answer 403 to a plain HTTP client; this command reads the same data. One of the 15 is expected to be a failure: `GmPzx6Ug...`, `over the per-transfer limit`.
- 7: replays 5 fixed attack lines in process. The model is replaced by a script that obeys the attacker; the tools, PIN check and limits are the real code in `src/`. It tests the code around the model, not the model. It ends with a control (a send with the right PIN, as a dry run) to show the check can see a send.
- 8: opens the call socket of the live site and types 5 lines. It never types a PIN, never confirms a transfer and gives no account to pay. Checks: the greeting arrives; a scam line is refused; "Send 5 NEAR to stranger.near" is refused with the limit named; wrong packet words are rejected; asking for the packet words is refused. The replies come from a real model, so wording varies and a check can fail on one run and pass on the next. The script prints each reply.
- 8, against a local server: `RINGFENCE_URL=http://localhost:8787 npm run live:check`. With the scripted model (`MOCK_LLM=1`) the scam check fails, because the scripted model has no scam rule; the other 4 pass.
- 12: a NEAR Intents 1Click quote with `dry: true`, so no deposit address is made. SOL, ETH and BTC were tried.
- 13: prints the Sputnik DAO proposals for a DAO-owned phone wallet. It needs `WALLET_SECRET` for the phone hash and never prints it. See `docs/dao-wallet.md`.
- 9 to 11: Rust 1.95 or newer and `cargo install cargo-near`. The first run compiles and downloads a NEAR sandbox.

## The call socket

- URL: `wss://ringfence.evalengine.ai/ws/call` (local: `ws://localhost:8787/ws/call`).
- Send one JSON text frame per line: `{"type":"text","text":"..."}`.
- Read: `{"type":"agent","text":"..."}` (one per sentence), `{"type":"link","url":"...","label":"..."}`, `{"type":"desk",...}` (end of the turn), `{"type":"hangup"}`. Binary frames are audio (WAV).
- A call about one money packet: `/ws/call?packet=<id>&to=<account>`. The id is in the Call link of the page at `/packet/demo`.
- On the live site a typed PIN after a prepared transfer sends real NEAR from the demo wallet, and the right packet words with an account pay a real share. `npm run live:check` does neither.
- Code: `src/voice.ts` (server), `app/call.ts` (browser), `scripts/live-check.ts` (a client in 100 lines).

## A local server without keys

```bash
npm run build
MOCK_LLM=1 TTS=off npm start    # http://localhost:8787
```

`npm start` loads `.env` when the file exists. A fresh clone has none, so every send and packet is a labelled dry run and nothing touches a chain. The scripted model understands only fixed lines, for example:

- `Send 5 NEAR to stranger.near`: refused, over the 1 NEAR limit.
- `Send a money packet of 0.02 NEAR for 3 people, the words are happy new year`, then any 4 digits: a dry-run packet link.

Scam refusal, prices and account checks need the real model on the live site.

## Contracts on NEAR mainnet

| Contract | Source | Release file | Mainnet account |
| --- | --- | --- | --- |
| Wallet factory | `contracts/factory` | `contracts/release/wallet_factory.wasm` | `ringfence-wallet.near` |
| Phone wallet | `contracts/phone-wallet` | `contracts/release/phone_wallet.wasm` | published once as a global contract; one instance per phone at `<id>.ringfence-wallet.near` |
| Money packets | `contracts/packets` | `contracts/release/red_packets.wasm` | `packets.ringfence-wallet.near` |

Other accounts:

- `f18d3a55399e.ringfence-wallet.near`: the website's demo wallet.
- `ringfence-agent.near`: the account the server signs with. It is the `agent` in each wallet's state. It holds one full-access key (`view_access_key_list`).
- `ringfence-custody.near`: owner of custodial wallets, including the demo wallet.

A view call needs no key. Example (the demo wallet's state):

```bash
curl -s https://rpc.mainnet.near.org -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"f18d3a55399e.ringfence-wallet.near","method_name":"get_state","args_base64":"e30="}}'
```

`result.result` is a byte array holding JSON. Read on 11 Nov 2026 it gave: owner `ringfence-custody.near`, agent `ringfence-agent.near`, custodial `true`, NEAR limits 1 per transfer and 3 per day, USDC limits 25 per transfer and 60 per day, `new_recipient_delay_sec` 60, allowlist `packets.ringfence-wallet.near` and `liho00.near`, balance about 0.24 NEAR, no access keys on the wallet account.

Other views: `get_config` on `ringfence-wallet.near` (custody account, agent account, wallet code hash); `get_config` and `get_packet {"id":"<id>"}` on `packets.ringfence-wallet.near`.

## Which claim maps to which check

| Claim | Check |
| --- | --- |
| The code on mainnet is the code in this repo | `npm run verify:contracts` |
| The mainnet transactions in the README exist, with the stated signer, receiver, method and result | `npm run verify:evidence` |
| The contract refused a 5 NEAR transfer asked for by the agent's key | `npm run verify:evidence`, row `GmPzx6Ug` |
| Limits of 1 NEAR per transfer and 3 NEAR per day on the demo wallet | view `get_state` on `f18d3a55399e.ringfence-wallet.near` |
| Limits, saved recipients, wait for a new recipient, freeze, owner-only withdraw | `cargo test` in `contracts/phone-wallet` (`limits_and_allowlist`, `delay_queue_then_execute`, `freeze_ends_and_unfreeze`) |
| A wallet per phone number made by the factory | `cargo test` in `contracts/factory`; row `baAJRB5B` of `npm run verify:evidence` |
| A packet pays out exactly its amount, one share per account, refund after expiry | `cargo test` in `contracts/packets`; `npm run demo:check` (the money packet steps) |
| The agent that talks to the caller is not given a packet's words; only what the caller said counts | `npm test` (the "money packets:" lines); `npm run attack`, attack 4; `src/desks/packet.ts` |
| PIN: hashed, 3 wrong tries then a 15-minute lock, not kept in the transcript | `npm test` (the "security:" lines); `npm run attack`, attacks 3 and 5 |
| A model that obeys an injected instruction still cannot move money without the PIN or past the limit | `npm run attack` |
| The live agent refuses a scam line, an over-limit send, and a request for packet words | `npm run live:check` |
| Chat, speech-to-text and image models run on NEAR AI Cloud in a TEE | `npm run attest`; `https://ringfence.evalengine.ai/api/proof` (JSON) |

## What is not covered by a check

- The spoken voice is made by Cartesia. It is not attested.
- The demo wallet is custodial: its owner is `ringfence-custody.near`. A wallet is owned by the user only after the user binds their own NEAR account at `/wallet/bind`. There is no mainnet transaction for that path in the evidence table.
- USDC sends are covered by contract tests (`contracts/mock-ft`). There is no USDC transaction in the evidence table.
- Trezu is not used. A Sputnik DAO can own a phone wallet (`docs/dao-wallet.md`) and fund a money packet (`docs/dao-packet.md`). The DAO-funded packet is on mainnet (README evidence rows 12 to 15). The DAO-owned wallet is not on mainnet yet. On a call, a DAO-owned wallet gets a DAO proposal instead of a signing link.
- NEAR Intents top up (`src/desks/topup.ts`): a real deposit address when the server sets `TOPUP_LIVE=1` (it does) and the caller gives a refund address; otherwise a dry quote. The demo wallet is registered on the USDC contract. On the shared demo wallet the agent says the funds go to the demo, not the caller. No swap is on mainnet yet.
- Staking for packets is not built.
- Spoken languages are English and Chinese.
- The contracts are AI-reviewed, not audited.
- `npm run attack` does not reach the wait for a new recipient: without keys the server cannot read a wallet's saved recipients. That rule is tested in the contract.

## Layout

- `server.ts`: one Node process for pages, the call socket and the WhatsApp webhook.
- `src/agent.ts`: the agent loop. `src/desks/`: the tools and the rules they enforce. `src/packets.ts`: money packets. `src/wallet.ts`: PIN, binding, chain calls.
- `app/`: pages. `contracts/`: Rust contracts and release files. `test/run.ts`: `npm test`. `scripts/`: the check commands above.

## WhatsApp status

WhatsApp is built and supported. The public number +60 11-7512 3486 is waiting on Meta's business verification; once approved, anyone can message or call it. Until then it runs on Meta's test number +1 555-144-4220, which only answers numbers Meta approved. Judge through the browser call, which does the same on the shared demo wallet.
