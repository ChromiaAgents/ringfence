// Verifies the TEE attestation of every model Ringfence uses. Network only, no API key: the endpoint is public.
//   npm run attest            (exit code 1 if any model fails a check)
import { attest } from '../src/ai.ts';
import { env } from '../src/config.ts';

const models = [env.llmModel, env.sttModel, env.imageModel];
const mark = (b: boolean) => (b ? 'PASS' : 'FAIL');
let bad = 0;
for (const model of models) {
  console.log(`\n== ${model}`);
  try {
    const a = await attest(model, true);
    console.log(`  signing address          ${a.signingAddress}`);
    console.log(`  nonce (ours)             ${a.nonce}`);
    console.log(`  report_data              ${a.reportDataHex}`);
    console.log(`  ${mark(a.intel.verified)}  Intel TDX quote signature + cert chain (collateral from Intel PCS)${a.intel.error ? ': ' + a.intel.error : ''}`);
    console.log(`        TCB status             ${a.intel.tcbStatus ?? '-'}${a.intel.advisoryIds?.length ? '  advisories: ' + a.intel.advisoryIds.join(', ') : ''}`);
    console.log(`  ${mark(a.quoteBindsKey)}  report_data = signing address || our nonce`);
    console.log(`  ${mark(a.gpu.verified)}  NVIDIA GPU attestation via NRAS (JWT signed by NVIDIA, nonce match)${a.gpu.error ? ': ' + a.gpu.error : ''}`);
    if (a.gpu.gpus) console.log(`        GPUs                   ${a.gpu.gpus} x ${a.gpu.arch}, evidence nonce is ours: ${a.gpu.nonceMatch}`);
    if (!(a.intel.verified && a.quoteBindsKey && a.gpu.verified)) bad++;
  } catch (e: any) {
    console.log(`  FAIL  ${e.message}`);
    bad++;
  }
}
console.log(`\n${models.length - bad}/${models.length} models fully verified`);
console.log('Verify independently: https://docs.near.ai/cloud/verification/ and https://github.com/Phala-Network/dcap-qvl');
process.exit(bad ? 1 : 0);
