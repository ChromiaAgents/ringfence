import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

// ---- business desk (owner.yaml) ----
export type Service = { id: string; name: string; from_usd: number; to_usd: number };
export type Owner = {
  business: { name: string; owner: string; area: string; greeting: string };
  services: Service[];
  rules: {
    max_discount_pct: number;
    deposit_pct: number;
    min_deposit_usd: number;
    max_deposit_usd: number;
    accept_jobs_outside_area: boolean;
    kill_switch: boolean;
    refuse_work?: string[];
  };
  payout: { asset: string; asset_symbol: string; asset_decimals: number; recipient: string };
};

export const OWNER_FILE = process.env.OWNER_FILE ?? 'owner.yaml';
export const LAUNCHPAD_FILE = process.env.LAUNCHPAD_FILE ?? 'launchpad.yaml';

// Re-read on every call so limits and kill switches change without a restart.
export function owner(): Owner {
  const raw = readFileSync(OWNER_FILE, 'utf8').replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
  return parse(raw) as Owner;
}

// ---- launch desk (launchpad.yaml) ----
export type Launchpad = {
  desk: { name: string; greeting: string };
  rules: {
    kill_switch: boolean;
    ticker_min: number;
    ticker_max: number;
    name_max: number;
    duration_min_minutes: number;
    duration_max_minutes: number;
    soft_cap_min_near: number;
    soft_cap_max_near: number;
    max_team_allocation_pct: number;
    min_cliff_days: number;
    min_vesting_days: number;
    total_supply: string;
    decimals: number;
  };
  launchpads?: { meme_cooking?: { enabled?: boolean }; justhoot?: { enabled?: boolean; ticker_min?: number; ticker_max?: number } };
  blocked_tickers: string[];
  blocked_names: string[];
  forbidden_claims: string[];
};

export function launchpad(): Launchpad {
  return parse(readFileSync(LAUNCHPAD_FILE, 'utf8')) as Launchpad;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  nearAiKey: process.env.NEARAI_API_KEY ?? '',
  mockLlm: process.env.MOCK_LLM === '1', // scripted chat + STT for offline timing; TTS stays real
  llmModel: process.env.LLM_MODEL ?? 'Qwen/Qwen3.6-35B-A3B-FP8',
  sttModel: process.env.STT_MODEL ?? 'openai/whisper-large-v3',
  imageModel: process.env.IMAGE_MODEL ?? 'black-forest-labs/FLUX.2-klein-4B',
  visionModel: process.env.VISION_MODEL ?? 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  network: (process.env.NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet',
  pinataJwt: process.env.PINATA_JWT ?? '',
  oneClickJwt: process.env.ONECLICK_JWT ?? '',
  waToken: process.env.WHATSAPP_TOKEN ?? '',
  waPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  waVerify: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  waAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  ownerWhatsapp: (process.env.OWNER_WHATSAPP ?? '').replace(/\D/g, ''),
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
  // Phone wallet: the agent account allowed to spend within each user's contract limits (on NETWORK).
  agentAccountId: process.env.AGENT_ACCOUNT_ID ?? '',
  agentKey: process.env.AGENT_PRIVATE_KEY ?? '',
  mpcSigner: process.env.MPC_SIGNER || (process.env.NETWORK === 'mainnet' ? 'v1.signer' : 'v1.signer-prod.testnet'),
  // EVM sends (Chain Signatures) stay in the code but are off unless EVM_ENABLED=1: the pitch is NEAR only for now.
  evmEnabled: /^(1|true|yes)$/i.test(process.env.EVM_ENABLED ?? ''),
  // Default limits proposed on /wallet/bind (the user can change them there before signing). Human units.
  walletDefaults: {
    nearPerTx: process.env.WALLET_NEAR_PER_TX ?? '1', nearPerDay: process.env.WALLET_NEAR_PER_DAY ?? '3',
    evmPerTx: process.env.WALLET_EVM_PER_TX ?? '0.0005', evmPerDay: process.env.WALLET_EVM_PER_DAY ?? '0.002',
    delaySec: Number(process.env.WALLET_DELAY_SEC ?? 600),
  },
  // WebRTC (WhatsApp calls): fixed UDP range so a firewall can open it. Empty = werift's random ports.
  rtcPorts: process.env.RTC_PORT_MIN && process.env.RTC_PORT_MAX ? ([Number(process.env.RTC_PORT_MIN), Number(process.env.RTC_PORT_MAX)] as [number, number]) : undefined,
};
