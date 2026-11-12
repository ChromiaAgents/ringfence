# The exact contract files for mainnet

These three files are the ones that passed the sandbox tests (`FACTORY_WASM`, `WALLET_WASM`, `PACKETS_WASM`) and the
ones the deploy commands use. They are copies, kept here because running a contract's tests rebuilds
`contracts/*/target/near/*.wasm` without the size pass. `SHA256SUMS` lists their hashes; `shasum -a 256 -c SHA256SUMS`
checks them. Rebuild with `contracts/build.sh`, re-run the sandbox tests against the new files, then copy them here.

| File | Bytes | What |
| --- | --- | --- |
| `phone_wallet.wasm` | 172,369 | one per phone, published once as a global contract (same file as `public/phone_wallet.wasm`) |
| `wallet_factory.wasm` | 138,830 | creates a wallet per phone number, with optional names (copied from `contracts/factory/target/near/` on 12 Nov 2026; its hash matches the code on `ringfence-wallet.near`) |
| `red_packets.wasm` | 158,585 | money packets: fund, lucky or equal split, open, refund |
