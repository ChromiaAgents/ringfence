// Prints what a Sputnik DAO needs to own a Ringfence phone wallet. No keys, no network, no transaction.
//
//   WALLET_SECRET=... NETWORK=mainnet npm run dao:wallet -- <dao account> <phone digits>
//
// WALLET_SECRET is the server's phone-hash key: only the server operator has it. Without it this refuses.
// The other way to get the same create_wallet args, with no secret: POST /api/wallet/code then /api/wallet/bind
// with owner = the DAO (docs/dao-wallet.md). Full steps: docs/dao-wallet.md
import { env } from '../src/config.ts';
import { bindTx, digits, ownerOk, walletFor, type Binding } from '../src/wallet.ts';
import { addProposalCmd, createWalletProposal, isDao, ownerProposals } from '../src/dao.ts';

const stop = (msg: string): never => { console.error(`REFUSED: ${msg}`); process.exit(1); };
const [dao = '', raw = ''] = process.argv.slice(2);
const phone = digits(raw);
if (!dao || !phone) stop('usage: npm run dao:wallet -- <dao account> <phone digits>');
if (!process.env.WALLET_SECRET) stop('WALLET_SECRET is not set. The phone_hash is an HMAC under the server secret; without it the hash would not match what the server looks up.');
if (phone.length < 8 || phone.length > 15) stop('the phone number is 8 to 15 digits, with country code');
if (!ownerOk(dao)) stop(`${dao} is not a ${env.network} account`);
if (!isDao(dao)) console.warn(`NOTE: ${dao} is not under sputnik-dao.near / sputnikv2.testnet. The proposal JSON below is Sputnik's shape.`);
if (!env.agentAccountId) env.agentAccountId = env.network === 'mainnet' ? 'ringfence-agent.near' : 'ringfence-agent.testnet';
if (!env.packetsAccountId && env.network === 'mainnet') env.packetsAccountId = 'packets.ringfence-wallet.near';

const tx = bindTx({ phone, owner: dao } as Binding);
const wallet = walletFor(phone);
const p = createWalletProposal(tx, phone.slice(-4));
const o = ownerProposals(wallet);
const show = (title: string, x: object) => console.log(`\n## ${title}\n${JSON.stringify(x, null, 2)}\n\n${addProposalCmd(dao, x)}`);

console.log(`Network          ${env.network}
DAO (owner)      ${dao}
Agent            ${tx.args.agent}
Phone            ...${phone.slice(-4)}
phone_hash       ${tx.args.phone_hash}
Factory          ${tx.receiverId}
Deposit          ${tx.deposit} yoctoNEAR (0.013 NEAR; what is not used is refunded to the DAO)
Wallet address   ${wallet} (expected; confirm after the vote with:
                 near view ${tx.receiverId} get_wallet '{"phone_hash":"${tx.args.phone_hash}"}')
Check first      the same get_wallet must print null now, or this number already has a wallet.

create_wallet args (decoded):
${JSON.stringify(tx.args, null, 2)}`);
show('1. Proposal: create the wallet (the final vote needs --gas 300000000000000)', p);
console.log(`\nVote: near call ${dao} act_proposal '{"id":<id>,"action":"VoteApprove","proposal":${JSON.stringify(p.proposal.kind)}}' --accountId <council member>.near --gas 300000000000000`);
console.log('\nLater, on the new wallet (each needs its own vote; amounts in yoctoNEAR, or USDC units with 6 decimals):');
show('set_limits (example: NEAR 0.5 a send, 1 a day)', o.set_limits('near', '500000000000000000000000', '1000000000000000000000000'));
show('allow (save a recipient)', o.allow('<recipient>.near'));
show('revoke_agent (the AI can no longer spend)', o.revoke_agent());
console.log('\nNothing was signed or sent. Every step above spends real NEAR only when a council member runs it.');
