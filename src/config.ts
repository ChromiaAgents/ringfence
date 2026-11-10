import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const LAUNCHPAD_FILE = process.env.LAUNCHPAD_FILE ?? 'launchpad.yaml';

// ---- launch desk (launchpad.yaml) ----
export type Launchpad = {
  desk: { name: string; greeting: string };
  rules: {
    kill_switch: boolean;
    ticker_min: number;
    ticker_max: number;
    name_max: number;
  };
  blocked_tickers: string[];
  blocked_names: string[];
  forbidden_claims: string[];
};

// Re-read on every call so limits and kill switches change without a restart.
export function launchpad(): Launchpad {
  return parse(readFileSync(LAUNCHPAD_FILE, 'utf8')) as Launchpad;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  nearAiKey: process.env.NEARAI_API_KEY ?? '',
  mockLlm: process.env.MOCK_LLM === '1', // scripted chat + STT for offline timing; TTS stays real
  llmModel: process.env.LLM_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  sttModel: process.env.STT_MODEL ?? 'openai/whisper-large-v3',
  imageModel: process.env.IMAGE_MODEL ?? 'black-forest-labs/FLUX.2-klein-4B',
  network: (process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet',
  oneClickJwt: process.env.ONECLICK_JWT ?? '',
  waToken: process.env.WHATSAPP_TOKEN ?? '',
  waPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  waVerify: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  waAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  // Phone wallet: the agent account allowed to spend within each user's contract limits (on NETWORK).
  agentAccountId: process.env.AGENT_ACCOUNT_ID ?? '',
  agentKey: process.env.AGENT_PRIVATE_KEY ?? '',
  // Wallet factory (create_wallet) and the custodial owner of WhatsApp-only wallets. Without CUSTODY_PRIVATE_KEY,
  // custodial creates and claims are labelled dry runs. FACTORY_PRIVATE_KEY is only for the one-time code upload (HANDOVER.md).
  factoryAccountId: process.env.FACTORY_ACCOUNT_ID || (process.env.NETWORK === 'mainnet' ? 'ringfence-wallet.near' : 'ringfence-wallet.testnet'),
  custodyAccountId: process.env.CUSTODY_ACCOUNT_ID || (process.env.NETWORK === 'mainnet' ? 'ringfence-custody.near' : 'ringfence-custody.testnet'),
  custodyKey: process.env.CUSTODY_PRIVATE_KEY ?? '',
  // HMAC key for phone hashes on chain and pepper for PIN hashes. Required on mainnet or with any key set.
  walletSecret: process.env.WALLET_SECRET ?? '',
  // The WhatsApp number people text (digits), shown as a wa.me link on /wallet/bind.
  waNumber: (process.env.WHATSAPP_NUMBER ?? '').replace(/\D/g, ''),
  // Tiered confirmation: up to SMALL_LIMIT NEAR to a saved recipient is confirmed by spoken PIN; more needs the WhatsApp Approve tap.
  smallLimitNear: process.env.SMALL_LIMIT ?? '0.2',
  // Red packets (contracts/packets). Empty = packets are labelled dry runs. Demo packets on the website are tiny.
  packetsAccountId: process.env.PACKETS_ACCOUNT_ID ?? '',
  packetExpirySec: Number(process.env.PACKET_EXPIRY_SEC ?? 86_400),
  demoPacketNear: process.env.DEMO_PACKET_NEAR ?? '0.02',
  demoPacketWords: process.env.DEMO_PACKET_WORDS ?? 'gong xi fa cai',
  // USDC on NEAR (native Circle USDC on mainnet, 6 decimals). Above SMALL_LIMIT_USDC a send also needs the Approve tap.
  usdcToken: process.env.USDC_TOKEN ?? '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
  smallLimitUsdc: process.env.SMALL_LIMIT_USDC ?? '10',
  // Website demo: browser calls (no phone number) use this shared wallet, PIN shown on the page. Its contract limits
  // and saved recipient are what keep it safe; leave DEMO_WALLET_PHONE empty to keep browser sends a labelled dry run.
  demoPhone: (process.env.DEMO_WALLET_PHONE ?? '').replace(/\D/g, ''),
  demoPin: process.env.DEMO_PIN ?? '',
  demoRecipient: process.env.DEMO_RECIPIENT ?? 'liho00.near',
  // Custodial demo wallets: spends stop above this balance; at most this many are created per day (protects the custody account).
  custodialMaxNear: process.env.CUSTODIAL_MAX_NEAR ?? '5',
  custodialDailyCap: Number(process.env.CUSTODIAL_DAILY_CAP ?? 20),
  mpcSigner: process.env.MPC_SIGNER || (process.env.NETWORK === 'mainnet' ? 'v1.signer' : 'v1.signer-prod.testnet'),
  // EVM sends (Chain Signatures) stay in the code but are off unless EVM_ENABLED=1: the pitch is NEAR only for now.
  evmEnabled: /^(1|true|yes)$/i.test(process.env.EVM_ENABLED ?? ''),
  // Default limits proposed on /wallet/bind (the user can change them there before signing). Human units.
  walletDefaults: {
    nearPerTx: process.env.WALLET_NEAR_PER_TX ?? '1', nearPerDay: process.env.WALLET_NEAR_PER_DAY ?? '3',
    usdcPerTx: '25', usdcPerDay: '60', // the contract's USDC defaults
    evmPerTx: process.env.WALLET_EVM_PER_TX ?? '0.0005', evmPerDay: process.env.WALLET_EVM_PER_DAY ?? '0.002',
    delaySec: Number(process.env.WALLET_DELAY_SEC ?? 600),
  },
  // WebRTC (WhatsApp calls): fixed UDP range so a firewall can open it. Empty = werift's random ports.
  rtcPorts: process.env.RTC_PORT_MIN && process.env.RTC_PORT_MAX ? ([Number(process.env.RTC_PORT_MIN), Number(process.env.RTC_PORT_MAX)] as [number, number]) : undefined,
};
