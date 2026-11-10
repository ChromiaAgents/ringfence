# Hackathon submission (draft, not submitted)

> Draft answers for the NEAR hackathon form. Submit once, by 14 Nov 2026 23:59 UTC, only after Tan says yes. The form also needs lead name, email, team size, mainnet payout account and consent; fill those in by hand.

## Project name

Ringfence

## One-liner

Pay by phone call: an AI agent sends NEAR for you, and a contract your family owns caps what it can spend.

## Description

Mum can make a phone call. She doesn't know how to use Meteor Wallet.

Ringfence turns a phone call into a NEAR wallet. She calls from WhatsApp or the browser, says "send 0.1 NEAR to liho.near", hears it read back and confirms. One AI agent handles the conversation and decides which tool to call, but it can't move money by itself. Every send goes through a NEAR contract the family owns, and that contract enforces a per-transfer limit, a daily limit and a saved-recipients list. The owner can revoke the agent with one transaction.

She can pay in NEAR or in US dollars (USDC): "send 50 dollars to the grocer" is 50 USDC, no price swings. The same call checks an account before paying it (an account that doesn't exist, or was made last week, gets a warning) and refuses scam scripts ("this is your bank, move your money now").

Confirmation scales with risk: a spoken PIN for small sends (0.2 NEAR, 10 USDC), an Approve / Cancel / Not me tap above that, and over the limit or to a new recipient the AI doesn't send at all. It sends a link so the owner signs in their own wallet. "Not me" locks the AI out for 15 minutes.

Anyone can try it without a phone: the website has a demo wallet with its PIN printed on the page. The contract caps it and only pays one saved account, so a public PIN is safe, and the Approve card appears on the page instead of WhatsApp.

Voice is sensitive, and the PIN is spoken out loud. So all three models (speech-to-text, chat, image generation) run on NEAR AI Cloud in trusted execution environments. The server verifies the Intel TDX and NVIDIA attestation itself and shows it on a public `/proof` page.

Honest status: mainnet signing is pending. The hosted demo's sends are a clearly labelled dry run. The contract has 38 unit tests and real-runtime sandbox tests (including a USDC send to a never-registered recipient), but it is unaudited.

## Tracks targeted

| Track | Why it fits |
| --- | --- |
| **Security** | The limits live in a NEAR contract, not in a prompt. Per-transfer and daily caps, a saved-recipient allowlist, a 600 s delay for new recipients, owner-only withdraw and revoke, and the agent is never the owner. The PIN is a salted scrypt hash with lockout, attestation is verified rather than trusted, and the worst case is written down, even with a malicious operator. |
| **Agents** | One AI agent decides every reply and action through tools (balance, prepare/confirm transfer, end call). The tools enforce PIN, tiers and approvals in code, and the agent acts on chain only through the owner's own limited contract. |
| **Real world** (listed as `business` in our notes; use whichever name the form shows) | The interface is a phone call, so people who will never install a wallet app (parents, grandparents) can pay. A family member can set it up as guardian and own the contract. |
| **Privacy** | Speech-to-text, chat and image generation all run in NEAR AI TEEs, and we verify the attestation in-process (Intel TDX quote and NVIDIA NRAS) and check every chat reply's signature. The spoken PIN is heard only inside TEEs and blanked from storage. Known gaps are stated: Cartesia TTS sees reply text (Kokoro local option), the app server itself isn't attested, Meta sees WhatsApp call metadata. |

## Tech used

- NEAR smart contract (Rust, near-sdk) per phone wallet, created through a factory with a global contract
- NEAR AI Cloud private inference: Whisper large v3 (speech), DeepSeek V4.1 Flash (chat), FLUX.2 klein (image generation)
- TEE attestation verification: `@phala/dcap-qvl` (Intel TDX), NVIDIA NRAS, ECDSA reply-signature recovery
- NEAR Wallet Selector (Meteor, HOT, Intear, MyNearWallet), near-api-js
- WhatsApp Cloud API: calls over WebRTC (werift + Opus), messages, interactive Approve buttons
- TanStack Start, React, Vite, TypeScript, Node; Cartesia or local Kokoro text-to-speech
- Built (off by default): NEAR Chain Signatures for EVM sends

## What's novel

- **The AI only asks; the contract decides.** The agent can't be talked past the limits, because they aren't in the prompt.
- **Confirmation scales with risk** (spoken PIN, then an Approve tap, then self-sign), so small sends stay a single phone call.
- **Family ownership.** A child can own the contract while Mum just calls.
- **Money she understands.** Dollars, not tokens: "send 50 dollars" is 50 USDC.
- **Try it with real money, no phone.** A public demo wallet whose safety is the contract, not the PIN.
- **Proof, not promises, for private AI.** Attestation is checked live in our own process and published on `/proof`.

## Who pays, and how it spreads

The buyer is not Mum; it's her children. Families in Malaysia, Singapore and the wider region already send money home and worry about phone scams, which cost Malaysians RM 2.97 billion in 2025, up from RM 1.57 billion in 2024 ([Home Ministry, via Malay Mail](https://www.malaymail.com/news/malaysia/2026/06/24/online-scam-losses-surge-to-rm297b-in-2025-says-home-ministry-as-fraud-trend-worsens-across-malaysia/225000)). Ringfence is the family plan for that: the child sets the limits and saved recipients once, the parent just calls.

- **Revenue:** a small fee on each send (a few basis points, taken by the agent's contract call) plus a monthly family plan for WhatsApp voice minutes. The contract and the limits stay free and open source.
- **Distribution:** WhatsApp is already on every parent's phone, so there is no app to install. Banks, remittance apps and wallets can white-label the line: they bring the users, the contract keeps the rules.
- **Why NEAR:** one cheap contract per phone (a factory over a global contract costs 0.013 NEAR per wallet), named accounts a parent can say out loud ("liho dot near"), native USDC, and private inference with attestation on NEAR AI.

## What's next

1. A dedicated WhatsApp number (Meta business verification is in review).
2. Recurring allowances ("send grandson RM 20 every Sunday"), and family funding in any coin through NEAR Intents.
3. Contract audit, then higher limits.
4. Faster voice on GPU, and an attested app server so transcripts never leave a TEE.

## Links

- Live demo (browser call): https://ringfence.evalengine.ai
- TEE proof: https://ringfence.evalengine.ai/proof
- Code: https://github.com/ChromiaAgents/ringfence (to be made public before submitting)
- Demo video: TODO
- X post: TODO
- Mainnet transactions: TODO (see README, "Mainnet evidence")

Made by Chromia x evalengine x NEAR.
