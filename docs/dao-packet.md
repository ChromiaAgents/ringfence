# A money packet funded by a Sputnik DAO

Status on 12 Nov 2026: **on mainnet.** README evidence rows 12 to 15. `liho00.near` created `ringfence-family.sputnik-dao.near`
(factory default code, version [3,2], 0.3 NEAR) with a custom low-bond policy: the council is `liho00.near` only, the proposal bond is 0.01 NEAR,
one vote passes, and only the council can propose. Proposal 0 called `create` with 0.05 NEAR for packet `family-1`
(5 lucky shares, 10 days). After the vote the packet holds 0.04427 NEAR with the DAO as creator. The server imported it
with `npm run import:packet`, and one share was opened on a live call. A DAO-owned wallet is still not on mainnet.

What this gives: a DAO votes on a proposal, the proposal locks NEAR in a money packet, and each member opens one
share by saying the words on a call.

## How it fits together

- `create` on the packets contract is payable and open to any account. See `contracts/packets/src/lib.rs`, `create`.
- Paying a share (`claim`) is agent-only. So a share is opened through the Ringfence server, on a call.
- The server only opens packets it has in its own store. `npm run import:packet` adds a packet that was funded on
  chain. It makes one view call, checks the words against the hash on chain, and signs nothing.
  See `scripts/import-packet.ts` and `importPacket` in `src/packets.ts`.
- The server operator learns the words at import. The contract only ever holds their hash.

## Steps

Steps marked **OWNER, REAL NEAR** spend real NEAR on mainnet and need the owner's signature. Nobody else runs them.
The commands use near-cli `near call`, as the Sputnik docs do.

| # | Do | Who | Cost |
|---|---|---|---|
| 1 | Create or pick a DAO | OWNER, REAL NEAR | DAO deposit, see step 1 |
| 2 | Pick an id and the words, compute the hash | anyone | none, no network |
| 3 | Add the proposal | OWNER, REAL NEAR | the DAO's proposal bond (1 NEAR by default, returned when the proposal passes) |
| 4 | Vote until it passes | OWNER (council), REAL NEAR | gas, and the packet amount leaves the DAO |
| 5 | Import the packet on the server | OWNER (server access) | none, no transaction |
| 6 | Open one share by call | anyone with the words | none for the caller, the agent pays gas |

### 1. Create or pick a DAO (OWNER, REAL NEAR)

- Use a DAO you already control, or create one on the factory `sputnik-dao.near`.
  See "Define the parameters of the new DAO" in https://github.com/near-daos/sputnik-dao-contract (README).
- The Sputnik example attaches 10 NEAR to the factory's `create`. The Sputnik example attaches 10 NEAR to the factory's `create`. `ringfence-family.sputnik-dao.near` was created with 0.3 NEAR (README evidence row 12); the factory's own minimum is 0.01 NEAR.
- The DAO must hold the packet amount plus gas on top of its own storage. Send it NEAR with a plain transfer.
- A testnet DAO cannot call the mainnet packets contract.

### 2. Pick an id and the words, compute the hash (no cost)

- The id is 1 to 64 characters of a-z, 0-9 and `-`, and must not be taken. Check it is free:
  `near view packets.ringfence-wallet.near get_packet '{"id":"<id>"}'` must print `null`.
- The hash is the sha256, in hex, of the id, a colon and the words with case, spaces and punctuation removed.
  See `norm` in `src/packets.ts`. Print it:

```bash
npm run import:packet -- <id> "<words>" --hash
```

- Keep the words private until the members need them. Do not put them in the proposal text: proposals are public.

### 3. Add the proposal (OWNER, REAL NEAR)

The proposal kind is `FunctionCall` with `receiver_id` and a list of `actions`. Each action has `method_name`,
`args` (base64 of the JSON arguments), `deposit` (yoctoNEAR, as a string) and `gas` (as a string).
See `ProposalKind::FunctionCall` and `ActionCall` in `sputnikdao2/src/proposals.rs` of the Sputnik repo.

Arguments of `create` (see the contract source for the limits: at most 100 shares, expiry at most 30 days):

```bash
ARGS=$(printf '%s' '{"id":"<id>","count":3,"lucky":true,"expires_in_sec":86400,"phrase_hash":"<hash from step 2>"}' | base64 | tr -d '\n')
```

Then the proposal. This example locks 0.1 NEAR (`100000000000000000000000` yocto) with 30 Tgas:

```bash
near call <dao>.sputnik-dao.near add_proposal '{"proposal":{"description":"Fund a money packet for 3 members","kind":{"FunctionCall":{"receiver_id":"packets.ringfence-wallet.near","actions":[{"method_name":"create","args":"'$ARGS'","deposit":"100000000000000000000000","gas":"30000000000000"}]}}}}' --accountId <you>.near --amount 1
```

- `--amount` must equal the DAO's proposal bond exactly. Read it: `near view <dao>.sputnik-dao.near get_policy`.
- The call returns the proposal id.
- The deposit must cover 0.001 NEAR per share plus the packet's storage. The contract takes the storage from the
  deposit, so the packet holds a little less than the deposit. `get_packet` shows the exact `total`.
- Leave `campaign` out. With `"campaign":true` the contract also sends a fee (5% plus 0.013 NEAR per share) to the
  packets contract owner.

### 4. Vote until it passes (OWNER, REAL NEAR)

```bash
near call <dao>.sputnik-dao.near act_proposal '{"id":<proposal id>,"action":"VoteApprove","proposal":<the same "kind" object you proposed>}' --accountId <council member>.near --gas 300000000000000
```

- New DAOs from `sputnik-dao.near` run Sputnik v3.2 (`get_default_version` returns `[3,2]` on 12 Nov 2026), whose
  `act_proposal(id, action, proposal, memo)` needs the proposal kind repeated, so the short form is refused.
- When the last needed vote lands, the DAO calls `create` with the deposit. Keep that transaction link.
- Check the result: `near view packets.ringfence-wallet.near get_packet '{"id":"<id>"}'`. The `creator` is the DAO.
- If `create` fails (id taken, deposit too small), the proposal shows as failed and no NEAR is locked.
  See `ProposalStatus::Failed` in the Sputnik source.

### 5. Import the packet on the server (OWNER with server access, no transaction)

Check first, from any machine. This writes nothing:

```bash
NETWORK=mainnet PACKETS_ACCOUNT_ID=packets.ringfence-wallet.near npm run import:packet -- <id> "<words>" --check
```

Then add it to the server's store. Stop the server first: a running server keeps the store in memory and would
write over the new packet. With the Docker setup in `SELF-HOST.md`:

```bash
docker stop ringfence
docker run --rm --env-file .env -v /opt/ringfence-data:/app/data ringfence npm run import:packet -- <id> "<words>"
docker start ringfence
```

- The command refuses when the words do not match the hash, the packet is expired, refunded or empty, the id is
  already in the store, or more than one share was already opened.
- The packet page never shows the words. Only if the words are meant to be public, add `--hint "<words>"`:
  the page then shows that text as what to say.
- The image must be built from a commit that contains `scripts/import-packet.ts`.

### 6. Open one share by call (anyone with the words)

1. Open `https://ringfence.evalengine.ai/packet/<id>`.
2. Type the NEAR account that should receive the share, then press the call button.
3. Say the words. The agent says the amount and puts the transaction link on the screen.
4. Keep that link. With the proposal link from step 4 it is the evidence: a DAO vote funded the packet, a call opened it.

## After the expiry

- What is left goes back to the creator, which is the DAO. The server asks the contract for that refund once the
  packet has expired. Anyone can also call `refund` on the contract.
- Before the expiry, only the creator or the contract owner can `cancel`. For a DAO that is another `FunctionCall`
  proposal to `cancel` with `{"id":"<id>"}` and a deposit of `"1"` (one yoctoNEAR).

## What is trusted

- The agent decides who said the words. The contract stops it paying one account twice, paying more than the
  packet holds, or paying after the expiry.
- The contract is not audited. Use small amounts.
