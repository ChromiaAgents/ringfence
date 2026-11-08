// EVM chains the phone wallet can sign for. One MPC path ("ethereum-1") gives the same address on all of them, so
// adding a chain is just this registry plus the owner allowing it on their contract (allow_chain).
// More via EXTRA_CHAINS='[{"id":59144,"name":"Linea","aliases":["linea"],"symbol":"ETH","decimals":18,"rpc":"https://rpc.linea.build","explorer":"https://lineascan.build"}]'
// RPC override per chain: RPC_<chainId>=https://... (SEPOLIA_RPC still works for 11155111).
export type Chain = { id: number; name: string; aliases: string[]; symbol: string; decimals: number; rpc: string; explorer: string; testnet?: boolean };

const BUILTIN: Chain[] = [
  { id: 8453, name: 'Base', aliases: ['base'], symbol: 'ETH', decimals: 18, rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
  { id: 1, name: 'Ethereum', aliases: ['ethereum', 'mainnet', 'l1'], symbol: 'ETH', decimals: 18, rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io' },
  { id: 42161, name: 'Arbitrum', aliases: ['arbitrum', 'arb'], symbol: 'ETH', decimals: 18, rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
  { id: 10, name: 'Optimism', aliases: ['optimism', 'op'], symbol: 'ETH', decimals: 18, rpc: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io' },
  { id: 137, name: 'Polygon', aliases: ['polygon', 'matic', 'pol'], symbol: 'POL', decimals: 18, rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com' },
  { id: 56, name: 'BNB Chain', aliases: ['bnb', 'bsc', 'binance'], symbol: 'BNB', decimals: 18, rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com' },
  { id: 43114, name: 'Avalanche', aliases: ['avalanche', 'avax'], symbol: 'AVAX', decimals: 18, rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
  { id: 11155111, name: 'Sepolia', aliases: ['sepolia'], symbol: 'ETH', decimals: 18, rpc: process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', testnet: true },
];

function extra(): Chain[] {
  try { return JSON.parse(process.env.EXTRA_CHAINS || '[]'); } catch { console.error('EXTRA_CHAINS is not valid JSON; ignored'); return []; }
}
export const CHAINS: Chain[] = [...BUILTIN, ...extra()].map((c) => ({ ...c, rpc: process.env[`RPC_${c.id}`] ?? c.rpc, aliases: c.aliases.map((a) => a.toLowerCase()) }));

export const chainById = (id: number) => CHAINS.find((c) => c.id === id);
/** "base", "Base", "8453", "evm:8453" → the chain. Plain "eth" is ambiguous (which chain?) and returns undefined. */
export function findChain(said: string): Chain | undefined {
  const s = String(said ?? '').trim().toLowerCase().replace(/^evm:/, '');
  if (/^\d+$/.test(s)) return chainById(Number(s));
  return CHAINS.find((c) => c.aliases.includes(s) || c.name.toLowerCase() === s);
}
/** The EVM chains a new phone wallet allows at bind time: Base on mainnet, Sepolia on testnet. Others: owner's allow_chain. */
export const defaultChainIds = (network: 'mainnet' | 'testnet') => (network === 'mainnet' ? [8453] : [11155111]);
export const txUrl = (c: Chain, hash: string) => `${c.explorer}/tx/${hash}`;
