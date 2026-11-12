// A phone wallet owned by a Sputnik DAO: the family's council holds the owner powers, not one person and not Ringfence.
// The contracts need no change: factory.create_wallet only asks that the caller is the owner, and a DAO calls it
// through a passed FunctionCall proposal. The server binds such a wallet like any owner-bound one (owner = the DAO).
// What differs is the owner's next step: no "sign this in your wallet" link, a DAO proposal instead.
// Proposal shape: ProposalInput { description, kind } and ProposalKind::FunctionCall / Transfer in
// sputnikdao2/src/proposals.rs (github.com/near-daos/sputnik-dao-contract).

/** Sputnik DAOs live under the factory: sputnik-dao.near on mainnet, sputnikv2.testnet on testnet. */
export const isDao = (account?: string | null) => /^[a-z0-9_-]+\.(sputnik-dao\.near|sputnikv2\.testnet)$/.test(String(account ?? ''));

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64');
/** One FunctionCall proposal. deposit in yoctoNEAR, gas in gas units, both as strings (U128 / U64 in JSON). */
export function callProposal(description: string, receiver_id: string, method_name: string, args: object, deposit = '0', gas = '30000000000000') {
  return { proposal: { description, kind: { FunctionCall: { receiver_id, actions: [{ method_name, args: b64(args), deposit, gas }] } } } };
}
/** A plain NEAR payment from the DAO's own balance (token_id "" is NEAR). */
export const transferProposal = (description: string, receiver_id: string, yocto: string) =>
  ({ proposal: { description, kind: { Transfer: { token_id: '', receiver_id, amount: yocto } } } });

/** create_wallet as the DAO's proposal. The factory deploys the wallet and calls back, so the action gets 200 Tgas
 *  and the final vote needs 300 Tgas. The factory refunds what is left of the deposit to the DAO. */
export const createWalletProposal = (tx: { receiverId: string; deposit: string; args: Record<string, unknown> }, last4: string) =>
  callProposal(`Create a Ringfence phone wallet for the number ending ${last4}, owned by this DAO`, tx.receiverId, 'create_wallet', tx.args, tx.deposit, '200000000000000');

/** Owner methods on the phone wallet need exactly one yoctoNEAR (only_owner: assert_one_yocto). */
const ONE = '1';
export const ownerProposals = (wallet: string) => ({
  set_limits: (asset: string, per_tx: string, per_day: string) =>
    callProposal(`Set the ${asset} limits of ${wallet}`, wallet, 'set_limits', { asset, per_tx, per_day }, ONE),
  allow: (recipient: string) => callProposal(`Let the phone wallet ${wallet} pay ${recipient}`, wallet, 'allow', { recipient }, ONE),
  revoke_agent: () => callProposal(`Remove the AI agent from ${wallet}`, wallet, 'revoke_agent', {}, ONE),
});

/** The near-cli line a council member runs. The bond must equal the DAO policy's proposal_bond exactly. */
export const addProposalCmd = (dao: string, p: object, bond = '<proposal_bond from get_policy, in NEAR>') =>
  `near call ${dao} add_proposal '${JSON.stringify(p)}' --accountId <council member>.near --amount ${bond}`;

/** What to say, instead of a signing link, when the caller asks for something only the owner may do. */
export function daoStep(owner: string, wallet: string, t: { to: string; amount: string; yocto: string }, why: 'new' | 'over') {
  const proposal = why === 'new'
    ? ownerProposals(wallet).allow(t.to)
    : transferProposal(`Pay ${t.amount} NEAR to ${t.to} (asked on a Ringfence call, over the phone wallet's limit)`, t.to, t.yocto);
  const what = why === 'new' ? `${t.to} is a new recipient` : 'it is over the limit';
  return {
    reason: `I can't send that myself: ${what}, and this wallet is owned by the DAO ${owner}. A DAO proposal is needed, so the council has to vote. Nothing was sent.`,
    label: why === 'new' ? `DAO proposal: save ${t.to} as a recipient` : `DAO proposal: pay ${t.amount} NEAR to ${t.to} from the DAO`,
    proposal,
    command: addProposalCmd(owner, proposal),
  };
}
