# CLAUDE.md

Read [AGENTS.md](AGENTS.md): it has what the project is, the commands with their expected last lines, the contract accounts, and which claim maps to which check.

The commands, in order. None needs a key or signs anything.

| Command | Network | Rough time | Expected last line |
| --- | --- | --- | --- |
| `npm ci` | yes | 15 s | `added <n> packages ...` and npm's audit summary |
| `npm test` | no | 15 s | `<n> passed` (55 on 12 Nov 2026) |
| `npm run demo:check` | no | 15 s | `all steps passed` |
| `npm run verify:contracts` | yes | 10 s | 3 blocks, each starting with `ok` |
| `npm run attest` | yes | 10 s | `3/3 models fully verified`, then one line of links |
| `npm run verify:evidence` | yes | 5 s | `11 of 11 transactions match` |
| `npm run attack` | no | 2 s | `5 of 5 attacks blocked` |
| `npm run live:check` | yes | 30 to 90 s | `5 of 5 checks passed` |
| `cargo test` in `contracts/phone-wallet`, `contracts/factory`, `contracts/packets` | first run | 4 min, 90 s, 100 s first run | `test result: ok.` |
