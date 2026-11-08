// Proves the launch_meme arguments we build are accepted by JustHoot's mainnet launchpad: builds them for a sample
// launch and calls the contract's own get_launch_deposit / get_launch_gas views. View only; nothing is signed or sent.
// npx tsx test/justhoot-cost.ts
import { justhootArgs, justhootCost, buildJustHootTx, smallIcon, JUSTHOOT } from '../src/justhoot.ts';
import { view, yoctoToNear } from '../src/memecook.ts';
import { drawLogo } from '../src/image.ts';

const icon = await smallIcon((await drawLogo('ZZZ')).icon);
const args = justhootArgs({ name: 'Sleepy Otter', symbol: 'ZZZ', icon });
const v = (m: string, a: object = {}) => view(m, a, 'mainnet', JUSTHOOT.contract);
console.log(`${JUSTHOOT.contract}: public launch ${await v('is_public_launch')}, wrap.near allowed ${await v('is_quote_token_allowed', { token_id: 'wrap.near' }).catch(() => '?')}`);
const cost = await justhootCost(args, 'example.near');
console.log(`icon ${icon.length} chars; launch deposit ${yoctoToNear(cost.launchDeposit)} NEAR, gas ${BigInt(cost.gas) / 10n ** 12n} Tgas`);
console.log(`registration needed: ${BigInt(cost.registerDeposit) > 0n ? yoctoToNear(cost.registerDeposit) + ' NEAR' : 'no'}; total ${yoctoToNear(cost.totalYocto)} NEAR; next token id ${cost.tokenId}`);
const tx = buildJustHootTx(args, cost);
console.log('tx:', JSON.stringify({ ...tx, actions: tx.actions.map((a) => ({ ...a, args: (a.args as any).args ? { args: { ...(a.args as any).args, icon: '<icon>' } } : a.args })) }, null, 1));
