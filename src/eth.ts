// Any EVM chain through NEAR Chain Signatures (same address on every chain): the phone-wallet contract asks the MPC signer to sign, so the ETH address
// belongs to the contract (predecessor) + path "ethereum-1". Derivation as in near/mpc crates/near-mpc-crypto-types kdf.rs:
//   tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor + "," + path)
//   derived = root + tweak·G
import { createHash } from 'node:crypto';
import { SigningKey, Transaction, Signature, JsonRpcProvider, computeAddress, decodeBase58, toBeHex, getAddress, formatUnits } from 'ethers';

export const ETH_PATH = 'ethereum-1';
export { CHAINS } from './chains.ts';
import type { Chain } from './chains.ts';

/** "secp256k1:<base58 x||y>" (NEAR format) → 0x04-prefixed uncompressed key. */
export const nearKeyToHex = (k: string) => '0x04' + toBeHex(decodeBase58(k.replace(/^secp256k1:/, '')), 64).slice(2);

export function deriveEthAddress(rootKey: string, predecessor: string, path = ETH_PATH) {
  const tweak = createHash('sha3-256').update(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`).digest();
  const pub = SigningKey.addPoints(SigningKey.computePublicKey(tweak), nearKeyToHex(rootKey));
  return { publicKey: pub, address: computeAddress(pub) };
}

/** A plain EIP-1559 transfer, the only shape the contract will sign. */
export function buildTransfer(p: { chainId: number | bigint; to: string; valueWei: bigint; nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }) {
  return Transaction.from({ type: 2, chainId: BigInt(p.chainId), to: getAddress(p.to), value: p.valueWei, nonce: p.nonce, gasLimit: 21000n, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas });
}

export type EvmRpc = Pick<JsonRpcProvider, 'getTransactionCount' | 'getFeeData' | 'getBalance' | 'broadcastTransaction'>;
export const rpcFor = (c: Chain): EvmRpc => new JsonRpcProvider(c.rpc, c.id, { staticNetwork: true });
const GAS = 21000n;

/** Refused before any signature request when the address can't pay value + max gas. */
export class GasShortError extends Error {
  constructor(public chain: Chain, public address: string, public missing: bigint) {
    super(`Not enough ${chain.symbol} on ${chain.name} for this transfer plus gas: ${formatUnits(missing, chain.decimals)} ${chain.symbol} short. Fund ${address} on ${chain.name}.`);
  }
}

/** Nonce and fees from the chain's RPC, then a balance check: value + maxFee × 21000 must be covered. */
export async function prepareTransfer(chain: Chain, from: string, to: string, valueWei: bigint, rpc: EvmRpc = rpcFor(chain)) {
  const [nonce, fee, balance] = await Promise.all([rpc.getTransactionCount(from, 'pending'), rpc.getFeeData(), rpc.getBalance(from)]);
  const maxFeePerGas = fee.maxFeePerGas ?? 20_000_000_000n, maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 1_000_000_000n;
  const need = valueWei + maxFeePerGas * GAS;
  if (balance < need) throw new GasShortError(chain, from, need - balance);
  return buildTransfer({ chainId: chain.id, to, valueWei, nonce, maxFeePerGas, maxPriorityFeePerGas });
}

/** The MPC signer's answer: { big_r: { affine_point: "02|03"+x }, s: { scalar }, recovery_id }. */
export type MpcSignature = { big_r: { affine_point: string }; s: { scalar: string }; recovery_id: number };
export function attachSignature(tx: Transaction, sig: MpcSignature) {
  const signed = tx.clone();
  signed.signature = Signature.from({ r: '0x' + sig.big_r.affine_point.slice(2), s: '0x' + sig.s.scalar, v: 27 + sig.recovery_id });
  return signed;
}

export async function broadcast(chain: Chain, signed: Transaction, rpc: EvmRpc = rpcFor(chain)) {
  const r = await rpc.broadcastTransaction(signed.serialized);
  return r.hash;
}
