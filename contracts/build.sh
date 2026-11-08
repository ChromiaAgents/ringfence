#!/usr/bin/env bash
# Smallest wasm for both contracts. Mainnet charges 0.0001 NEAR per byte (burned) to publish the phone wallet as a
# global contract, so bytes are NEAR. Usage: contracts/build.sh [--evm]   (--evm adds Chain Signatures to the wallet)
#   1. cargo near build (release profile: opt-level z, lto, codegen-units 1, panic abort, strip) without the ABI
#      (nobody reads the embedded ABI on chain; it costs ~2.3 KB),
#   2. local paths remapped out of panic messages (shorter, and no home directory in the wasm),
#   3. wasm-opt -Oz (binaryen, `brew install binaryen`) on top of cargo near's -O, keeping the same wasm features
#      (MVP + memory.copy/fill, + sign-ext only if
#      cargo near's output already has it), so the runtime sees nothing new.
# Output: contracts/<name>/target/near/<name>.wasm, and public/phone_wallet.wasm.
set -euo pipefail
cd "$(dirname "$0")"
EVM=(); [[ "${1:-}" == "--evm" ]] && EVM=(--features evm)
SYSROOT="$(rustc --print sysroot)"
CARGO_REG="${CARGO_HOME:-$HOME/.cargo}/registry/src"
flags() { echo "RUSTFLAGS=-C link-arg=-s --remap-path-prefix=$SYSROOT=/rust --remap-path-prefix=$CARGO_REG=/cargo --remap-path-prefix=$PWD/$1=/src"; }
shrink() {
  if command -v wasm-opt >/dev/null; then
    # Allow only the features the input already uses: try MVP + memory.copy/fill, then add sign-ext if needed.
    local feats=(--mvp-features --enable-bulk-memory-opt)
    wasm-opt "${feats[@]}" "$1" -o /dev/null 2>/dev/null || feats+=(--enable-sign-ext)
    wasm-opt -Oz "${feats[@]}" --strip-debug --strip-producers "$1" -o "$1.tmp" && mv "$1.tmp" "$1"
  else echo "wasm-opt not found: skipping the -Oz pass (brew install binaryen)" >&2; fi
}
(cd phone-wallet && cargo near build non-reproducible-wasm --locked --no-abi ${EVM[@]+"${EVM[@]}"} --env "$(flags phone-wallet)")
shrink phone-wallet/target/near/phone_wallet.wasm
(cd factory && cargo near build non-reproducible-wasm --locked --no-abi --env "$(flags factory)")
shrink factory/target/near/wallet_factory.wasm
cp phone-wallet/target/near/phone_wallet.wasm ../public/phone_wallet.wasm
wc -c phone-wallet/target/near/phone_wallet.wasm factory/target/near/wallet_factory.wasm
