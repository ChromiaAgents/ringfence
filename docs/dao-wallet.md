# A phone wallet owned by a Sputnik DAO

Status on 12 Nov 2026: **not on mainnet yet.** No DAO owns a phone wallet. (A DAO-funded packet is on mainnet: see docs/dao-packet.md.) The script and the proposal shapes were
tested offline by `npm test` and a dry run. Nothing below happens until the owner does the steps.

What this gives: the family's DAO council holds the owner powers of a phone wallet, instead of Ringfence's custody
account or one person. Mum still just calls. The AI agent still spends only inside the contract limits. Any owner
change needs a DAO vote.

No contract change is needed. `create_wallet` on `ringfence-wallet.near` only asks that the caller is the owner
(`contracts/factory/src/lib.rs`, "the caller must be the owner"). A DAO is the caller when a passed proposal runs.

## What changes for custody

- Ringfence's custody key (`ringfence-custody.near`) has no power over this wallet. It is not the owner.
- The agent (`ringfence-agent.near`) stays inside the limits the contract holds. It cannot raise them.
- Owner actions (`set_limits`, `allow`, `allow_chain`, `revoke_agent`, `withdraw`, `freeze`) need a DAO proposal
  and enough council votes. Each takes exactly one yoctoNEAR, which the proposal attaches.
- Slower on purpose: a new recipient or a payment over the limit waits for a vote.

## Steps

Steps marked **OWNER, REAL NEAR** spend real NEAR on mainnet and need a council member's signature.

| # | Do | Who | Cost |
|---|---|---|---|
| 1 | Create or pick a DAO, fund it | OWNER, REAL NEAR | DAO deposit, see docs/dao-packet.md step 1 |
| 2 | Get the create_wallet args | server operator, or the DAO by WhatsApp code | none, no transaction |
| 3 | Add the create proposal | OWNER, REAL NEAR | the proposal bond (returned when it passes) |
| 4 | Vote until it passes | OWNER (council), REAL NEAR | gas, plus 0.013 NEAR from the DAO, unused part refunded |
| 5 | Fund the wallet | anyone, REAL NEAR | the amount sent |
| 6 | Call and spend inside the limits | Mum | none for the caller, the agent pays gas |
| 7 | Later owner changes | OWNER, REAL NEAR | a bond and a vote each |

### 2. Get the create_wallet args (no cost)

Option A, the server operator (has `WALLET_SECRET`):

```bash
WALLET_SECRET=... NETWORK=mainnet npm run dao:wallet -- family.sputnik-dao.near 15550104477
```

It prints the phone_hash, the decoded `create_wallet` args (owner = the DAO, agent = `ringfence-agent.near`,
1 NEAR a send, 3 a day, 600 s wait for a new recipient, the packets contract saved as a recipient), the deposit,
the `add_proposal` JSON, the near-cli lines, and the follow-up proposals for `set_limits`, `allow` and
`revoke_agent`. It refuses without `WALLET_SECRET` and never prints it. It signs and sends nothing.

Option B, anyone with the phone, no secret: the same bind steps as `/wallet/bind`, with owner = the DAO.

```bash
curl -X POST https://ringfence.evalengine.ai/api/wallet/code -H 'content-type: application/json' \
  -d '{"phone":"15550104477","purpose":"bind","owner":"family.sputnik-dao.near"}'
# Mum gets a code on WhatsApp naming the DAO as owner
curl -X POST https://ringfence.evalengine.ai/api/wallet/bind -H 'content-type: application/json' \
  -d '{"phone":"15550104477","code":"<code>","pin":"<4 digits>","owner":"family.sputnik-dao.near"}'
```

The answer is the same `create_wallet` call. This also saves the binding and the PIN on the server, which the call
needs. With option A, do option B too (or the operator adds the binding), or calls will not find the wallet.
The bind web page itself asks you to connect a wallet as owner, and a DAO cannot connect, so use the API.
WhatsApp codes need the live WhatsApp sender, which is still on Meta's test number.

### 3 and 4. Propose and vote (OWNER, REAL NEAR)

Run the `add_proposal` line the script prints. `--amount` must equal the DAO's proposal bond:
`near view family.sputnik-dao.near get_policy`. The action has 200 Tgas, so the final vote needs `--gas 300000000000000`.
Whether 200 Tgas is enough was not tested on chain. The vote form with `"proposal"` follows the current
`act_proposal(id, action, proposal, memo)`. Sputnik v3.2, the version `sputnik-dao.near` gives new DAOs, needs the proposal kind repeated in the vote. `npm run dao:wallet` prints that form.

Check after the vote: `near view ringfence-wallet.near get_wallet '{"phone_hash":"<hash>"}'` prints the wallet,
and `near view <wallet> get_state` shows the DAO as owner.

### 7. Later owner changes (OWNER, REAL NEAR)

The script prints these. Each is a `FunctionCall` proposal to the wallet with a deposit of `"1"`:

- `set_limits` with `{"asset":"near","per_tx":"<yocto>","per_day":"<yocto>"}`
- `allow` with `{"recipient":"<account>"}`
- `revoke_agent` with `{}`: the AI can no longer spend

## On calls

The server finds the wallet like any owner-bound one: the binding's owner is the DAO, and `walletState` checks the
chain shows that owner and our agent. Where an owner would get a "sign this in your wallet" link (a new recipient,
or over the limit), a DAO-owned wallet should instead say a DAO proposal is needed and give the proposal JSON:
`allow` for a new recipient, a Sputnik `Transfer` from the DAO for over the limit. `daoStep` in `src/dao.ts`
builds that, and `src/desks/wallet.ts` uses it for both cases. No Sputnik web
UI link is given, because none was checked.

## How it pairs with money packets

The same DAO can fund a money packet (docs/dao-packet.md). The wallet already saves `packets.ringfence-wallet.near`
as a recipient, so Mum can also make a packet by voice from the DAO-owned wallet, inside its limits.

## What is trusted

- The contracts are not audited. Use small amounts.
- The Ringfence server holds the PIN hash and decides who said the PIN. The contract caps what any mistake can cost.
