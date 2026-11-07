import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

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
  };
  payout: { asset: string; asset_symbol: string; asset_decimals: number; recipient: string };
};

const FILE = process.env.OWNER_FILE ?? 'owner.yaml';

// Re-read on every call so the owner can flip the kill switch or change limits without a restart.
export function owner(): Owner {
  const raw = readFileSync(FILE, 'utf8').replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] ?? '');
  return parse(raw) as Owner;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  nearAiKey: process.env.NEARAI_API_KEY ?? '',
  llmModel: process.env.LLM_MODEL ?? 'Qwen/Qwen3.6-35B-A3B-FP8',
  sttModel: process.env.STT_MODEL ?? 'openai/whisper-large-v3',
  oneClickJwt: process.env.ONECLICK_JWT ?? '',
  waToken: process.env.WHATSAPP_TOKEN ?? '',
  waPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  waVerify: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
  waAppSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  dashboardPassword: process.env.DASHBOARD_PASSWORD ?? '',
};
