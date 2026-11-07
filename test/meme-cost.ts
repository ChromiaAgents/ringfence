// Proves the create_meme arguments we build are accepted by meme.cooking's contract: builds them for a sample
// launch and calls the contract's own create_meme_storage_cost view over RPC. View only; nothing is signed or sent.
// npx tsx test/meme-cost.ts [testnet|mainnet]
import { createMemeArgs, launchCost, buildTx, net, view, yoctoToNear } from '../src/memecook.ts';
import { drawLogo } from '../src/image.ts';

const network = (process.argv[2] === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const signer = network === 'mainnet' ? 'example.near' : 'example.testnet';
const { icon, bytes } = await drawLogo('ZZZ');
const args = createMemeArgs({
  name: 'Sleepy Otter', symbol: 'ZZZ', description: 'An otter that naps through every dip.', icon,
  durationMinutes: 60, softCapNear: 100, team: { pct: 5, cliffDays: 7, vestingDays: 30 }, totalSupply: '1000000000', decimals: 18,
}, { reference: '', reference_hash: '' }, network);

console.log(`${network}: ${net(network).contract}, running=${await view('whitelisted_token_ids', {}, network).then((w: string[]) => `whitelist ${w.join(',')}`)}`);
const cost = await launchCost(args, signer, network);
const tx = buildTx(args, cost, network);
console.log(`icon ${bytes} bytes; create_meme_storage_cost accepted the args: ${yoctoToNear(cost.createDeposit)} NEAR`);
console.log(`registration needed: ${BigInt(cost.registerDeposit) > 0n ? yoctoToNear(cost.registerDeposit) + ' NEAR' : 'no'}; total ${yoctoToNear(cost.totalYocto)} NEAR`);
console.log('tx:', JSON.stringify({ ...tx, actions: tx.actions.map((a) => ({ ...a, args: { ...a.args, icon: (a.args as any).icon ? '<icon>' : undefined } })) }, null, 1));
if (!args.deposit_token_id || !(await view<string[]>('whitelisted_token_ids', {}, network)).includes(args.deposit_token_id)) throw new Error('deposit token is not whitelisted on this contract');
console.log('deposit token is whitelisted: ok');
