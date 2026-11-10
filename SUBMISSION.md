# Hackathon submission (draft, not submitted)

> Draft answers for the NEAR hackathon form. Submit once, by 14 Nov 2026 23:59 UTC, only after Tan says yes. The form also needs lead name, email, team size, mainnet payout account and consent; fill those in by hand.

## Project name

Ringfence

## One-liner

Pay by phone call: an AI agent sends NEAR for you, and a contract your family owns caps what it can spend.

## Description

Mum can make a phone call. She doesn't know how to use Meteor Wallet.

Ringfence turns a phone call into a NEAR wallet. She calls from WhatsApp or the browser, says "send 0.1 NEAR to liho.near", hears it read back and confirms. One AI agent handles the conversation and decides which tool to call, but it can't move money by itself. Every send goes through a NEAR contract the family owns, and that contract enforces a per-transfer limit, a daily limit and a saved-recipients list. The owner can revoke the agent with one transaction.

Confirmation scales with risk: a spoken PIN up to 0.2 NEAR, a WhatsApp Approve tap above that, and over the limit or to a new recipient the AI doesn't send at all. It sends a link so the owner signs in their own wallet.

Voice is sensitive, and the PIN is spoken out loud. So all three models (speech-to-text, chat, image generation) run on NEAR AI Cloud in trusted execution environments. The server verifies the Intel TDX and NVIDIA attestation itself and shows it on a public `/proof` page.

Honest status: mainnet signing is pending. The hosted demo's sends are a clearly labelled dry run. The contract has 23 unit tests and a sandbox test, but it is unaudited.

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
- **Family ownership.** A guardian can own the contract while Mum just calls.
- **Proof, not promises, for private AI.** Attestation is checked live in our own process and published on `/proof`.

## What's next

1. First mainnet transactions: deploy the factory, bind a wallet, a real 0.1 NEAR voice send, a recorded refused over-limit send.
2. A dedicated WhatsApp number (off Meta's 5-recipient test number).
3. Contract audit, then stablecoins (`ft_transfer`).
4. Faster voice on GPU, and an attested app server so transcripts never leave a TEE.

## Links

- Live demo (browser call): https://ringfence.evalengine.ai
- TEE proof: https://ringfence.evalengine.ai/proof
- Code: https://github.com/ChromiaAgents/ringfence (to be made public before submitting)
- Demo video: TODO
- X post: TODO
- Mainnet transactions: TODO (see README, "Mainnet evidence")

Made by Chromia x evalengine x NEAR.
