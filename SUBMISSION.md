# Hackathon submission (draft, NOT submitted)

Deadline: 14 November 2026, 23:59 UTC (15 November, 07:59 in Malaysia). One attempt: a submission can't be edited or sent twice.
Nothing here is sent until Tan says yes to the exact payload below.

## Fields

| Field | Value | Status |
| --- | --- | --- |
| projectName | Ringfence | ready |
| leadName | Tan Li Ho | confirm |
| email | (Tan to give) | **missing** |
| size | 2 - 4 | decided (with Johnson) |
| tracks | social, realworld, security, privacy, open | decided |
| nearAddress | liho00.near | decided |
| projectUrl | https://github.com/ChromiaAgents/ringfence | ready |
| demoUrl | (the X post's link, after Tan posts it) | **missing** |
| idea | below, 1916 of 2000 characters | ready for review |
| consent | true, only after Tan agrees to: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." | **needs Tan's yes** |

## idea (1916 characters)

The people we most want to send money to can make a phone call but will never install a wallet. And an AI that moves money on a call must be impossible to talk into it.

Ringfence is a phone line for NEAR. You call it in the browser or on WhatsApp, and one AI agent acts from a wallet tied to your phone number.

Money packets (the Chinese red packet, made digital): "send a money packet of 1 NEAR for 5 people, the words are happy new year". The money is locked in a contract. Each person opens one share by saying the words on a call. Equal or lucky split, rolled on chain. Brands pay 5% to run packets as promotions, and every share opened creates a wallet.

Pay by voice: "send 0.1 NEAR to liho00.near", a spoken PIN, sent. NEAR and USDC.

The AI only asks; the contract decides. Each phone number gets its own NEAR contract, created by a factory from a global contract for 0.013 NEAR and owned by the person or their family: limits per send and per day, saved recipients, a wait on new ones, freeze, revoke in one transaction. People already on NEAR bind their number to a wallet they own.

Private AI: chat and speech-to-text run in NEAR AI Cloud TEEs. Our server verifies the Intel TDX and NVIDIA attestation and shows it on /proof.

Live on NEAR mainnet, with explorer links in the README: a voice send, the contract refusing the agent's request for 5 NEAR ("over the per-transfer limit"), and a packet share opened by saying "happy new year". `npm run verify:contracts` checks that the deployed code is the code in the repo. 52 app checks, 64 contract unit tests, 7 sandbox tests. An AI security review found a critical and a high issue in the packets contract; both were fixed and redeployed. The contracts are not audited, so amounts are tiny. WhatsApp runs on Meta's test number until business verification clears; the browser call does everything.

Next: packets that grow, staked until they are opened.

## Why each track

| Track | Why it fits |
| --- | --- |
| social | Money packets: one gift split between a group, opened with a spoken phrase; brand packets as rewards |
| realworld | Payments by phone call in NEAR and USDC for people who will never install a wallet |
| security | Spending limits in a per-phone contract; the contract refuses the AI on chain; scam calls refused |
| privacy | Chat and speech-to-text in NEAR AI Cloud TEEs, attestation verified by our server and shown on /proof |
| open | A phone call as the wallet interface |

## Before sending

1. Deploy the latest site and film.
2. Rotate the deploy keys.
3. Tan posts on X with the film (X-POST.md) and gives the post's link.
4. Print the JSON payload, Tan says yes, then one POST to https://nearhackathon.com/api/applications.
5. Keep the demo up until 25 November.
