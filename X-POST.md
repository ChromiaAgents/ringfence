# X post drafts (not posted)

> Do not post without Tan's yes. Tags come from HANDOVER.md's plan (item 9): `@NEARProtocol` and `#NEARHackathon`, optional `@NearLegion` and `@NearBuilders`. There is no HACKATHON.md in the repo, so check these against the official hackathon rules before posting. Replace TODO links first.

## Launch post (under 280 chars)

```
Mum can make a phone call. She doesn't know how to use Meteor Wallet.

Ringfence: pay by phone call. An AI sends NEAR for you, and a contract your family owns caps what it can spend.

Try the browser call: ringfence.evalengine.ai

@NEARProtocol #NEARHackathon
```

## Thread (4 posts)

**1/4**
```
Mum can make a phone call. She doesn't know how to use Meteor Wallet.

So we built Ringfence: call from WhatsApp or the browser, say "send 0.1 NEAR to liho.near", confirm, done.

#NEARHackathon @NEARProtocol
```

**2/4**
```
The AI only asks. A NEAR contract the family owns decides.

Per-send and daily caps, saved recipients only, revoke in one tx.

Up to 0.2 NEAR: spoken PIN
Above: WhatsApp Approve tap
Over limit or new recipient: you sign it yourself
```

**3/4**
```
Your voice and PIN stay private: speech, chat and image models run in TEEs on NEAR AI Cloud.

We verify the Intel TDX + NVIDIA attestation ourselves and show it live:
ringfence.evalengine.ai/proof
```

**4/4**
```
Honest status: mainnet signing is pending, so sends in the demo are a labelled dry run.

Try it: ringfence.evalengine.ai
Code: github.com/ChromiaAgents/ringfence
Video: TODO

Chromia x evalengine x NEAR
```
