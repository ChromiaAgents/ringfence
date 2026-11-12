// Reads the mainnet transactions in the README "Mainnet evidence" table from a public archival RPC and prints, for
// each, signer, receiver, method and result, with ok or DIFF against the expected values kept below.
// The explorer pages (nearblocks.io) answer 403 to a plain HTTP client; this reads the same data from the chain.
// Usage: npm run verify:evidence   (network only, no keys, read only)
//        NEAR_ARCHIVAL_RPC=https://... npm run verify:evidence   (another archival RPC)
export {}; // a module, so top-level await type-checks
const RPCS = process.env.NEAR_ARCHIVAL_RPC ? [process.env.NEAR_ARCHIVAL_RPC] : ['https://archival-rpc.mainnet.fastnear.com', 'https://archival-rpc.mainnet.near.org'];

const AGENT = 'ringfence-agent.near', CUSTODY = 'ringfence-custody.near', FACTORY = 'ringfence-wallet.near';
const DAO = 'ringfence-family.sputnik-dao.near';
const PACKETS = 'packets.ringfence-wallet.near', WALLET = 'f18d3a55399e.ringfence-wallet.near';
// One row per hash in the README table, in the same order. result is 'success', or the panic text of a failed call.
// args lists text that must be in the call's arguments.
type Row = { hash: string; what: string; signer: string; receiver: string; method: string; result: string; args?: string[] };
const ROWS: Row[] = [
  { hash: 'A1ptRucPSaQQUqRZeDmzaaWYz1ajjoaWJokyfWeuwQf8', what: 'factory deployed', signer: FACTORY, receiver: FACTORY, method: 'DeployContract+new', result: 'success' },
  { hash: 'AWCWv4mBsivz3aivTeYRRXWFhn8bFzHsUifTEJuDG2w4', what: 'phone-wallet code published as a global contract', signer: CUSTODY, receiver: FACTORY, method: 'upload_wallet_code', result: 'success' },
  { hash: 'GJaYffS6n1XiYcBQCJyqFWwyexsfo1HUyMdQSDRN5Ufm', what: 'packets contract deployed', signer: PACKETS, receiver: PACKETS, method: 'DeployContract+new', result: 'success' },
  { hash: '6wYAUvK4ym19aiU9zJzq7258M1aew2YSdTZmxvDKBGGR', what: 'packets contract upgraded', signer: PACKETS, receiver: PACKETS, method: 'DeployContract', result: 'success' },
  { hash: 'baAJRB5BLFCmway2HD7mq1UovQhNsuM8j1er3Z3Qhkk', what: 'demo phone wallet created by the factory', signer: CUSTODY, receiver: FACTORY, method: 'create_wallet', result: 'success', args: ['"owner":"ringfence-custody.near"', '"custodial":true'] },
  { hash: '7oou7MrdztYBtHy53koSCC6SveUyiX9FRrCLWS1krhqF', what: 'owner saves one payee', signer: CUSTODY, receiver: WALLET, method: 'allow', result: 'success', args: ['"recipient":"liho00.near"'] },
  { hash: '9k37rWDGE9c4p3DACFjb4BhZ7dZ2ScNLGrnChfBrrFua', what: 'voice send of 0.1 NEAR', signer: AGENT, receiver: WALLET, method: 'transfer_near', result: 'success', args: ['"to":"liho00.near"', '"amount":"100000000000000000000000"'] },
  { hash: 'GmPzx6UgxX9jJsDpHEZRodEhSmABZ3uRqFr2WzANCUd8', what: 'the contract refuses 5 NEAR', signer: AGENT, receiver: WALLET, method: 'transfer_near', result: 'over the per-transfer limit', args: ['"amount":"5000000000000000000000000"'] },
  { hash: '7HkYdRt4W8gqbZWHShHN22qfmUsJHw4CZXmqBWZ46xFT', what: 'money packet funded, 0.02 NEAR', signer: AGENT, receiver: WALLET, method: 'transfer_near', result: 'success', args: ['"to":"packets.ringfence-wallet.near"', '"amount":"20000000000000000000000"'] },
  { hash: '4noicreqHQgZmYz8iQpCmH8CV3fy3wYuC7ndHTYnsVa1', what: 'money packet recorded, 5 lucky shares', signer: AGENT, receiver: PACKETS, method: 'create_for', result: 'success', args: ['"count":5', '"lucky":true'] },
  { hash: '8EyQjwqWo5vJYqaSKVuo3586zqQQrs86JMvRzGBvZxH', what: 'a share opened', signer: AGENT, receiver: PACKETS, method: 'claim', result: 'success', args: ['"to":"liho00.near"'] },
  { hash: 'Frt5nXX3E3BFQjfzyHriq1j3UtUnXUtWkEWwZSdA52ud', what: 'family DAO created on sputnik-dao.near', signer: 'liho00.near', receiver: 'sputnik-dao.near', method: 'create', result: 'success', args: ['"name":"ringfence-family"'] },
  { hash: '4ufAXe2XFRaWQcYCYZNRHExmUTLpLL8RQ6vHTRVbhxv3', what: 'DAO proposal to fund a money packet', signer: 'liho00.near', receiver: DAO, method: 'add_proposal', result: 'success' },
  { hash: 'EAL2uMt6dheQ6upUqstRu3UgoMbRixbbE4Nj1ntytgCW', what: 'DAO vote passes, the DAO funds the packet', signer: 'liho00.near', receiver: DAO, method: 'act_proposal', result: 'success', args: ['"action":"VoteApprove"'] },
  { hash: '71C9Ve2z7arjaJxAeZMHH6dDxpUE5cpMxafP2yUAYPw3', what: 'a share of the DAO packet opened', signer: AGENT, receiver: PACKETS, method: 'claim', result: 'success', args: ['"id":"family-1"', '"to":"liho00.near"'] },
  { hash: '8kCunWQQuvp1EpKUgDrcTgqp3AVS5vtN323v7jV316AF', what: 'a top up from Solana landed as USDC through NEAR Intents', signer: 'intents.near', receiver: 'intents.near', method: 'execute_intents', result: 'success', args: ['0ffc41d0982d.ringfence-wallet.near'] },
  { hash: '2mvYoracrLfSbVae35NRWirQkNWo9nBy1ytu3vbT8MU4', what: 'a voice send to a new recipient, held by the wallet contract', signer: AGENT, receiver: 'liho.ringfence-wallet.near', method: 'transfer_near', result: 'success', args: ['"to":"liho00.near"'] },
  { hash: '3HWK1vG1tqh9AW4bSQGXSyHMRy6eqS57rVJMKTVHUCEq', what: 'the held send released after the new-recipient wait', signer: AGENT, receiver: 'liho.ringfence-wallet.near', method: 'execute', result: 'success' },
];

async function tx(hash: string, sender: string): Promise<any> {
  let last = '';
  for (const url of RPCS) {
    try {
      const r: any = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tx', params: { tx_hash: hash, sender_account_id: sender, wait_until: 'FINAL' } }) })).json();
      if (r.result) return r.result;
      last = `${url}: ${JSON.stringify(r.error).slice(0, 160)}`;
    } catch (e: any) { last = `${url}: ${e.message}`; }
  }
  throw new Error(last);
}

let diffs = 0;
for (const row of ROWS) {
  try {
    const r = await tx(row.hash, row.signer), t = r.transaction;
    const method = t.actions.map((a: any) => (typeof a === 'string' ? a : a.FunctionCall ? a.FunctionCall.method_name : Object.keys(a)[0])).join('+');
    const call = t.actions.find((a: any) => a.FunctionCall)?.FunctionCall;
    const args = call && call.method_name !== 'upload_wallet_code' ? Buffer.from(call.args, 'base64').toString() : ''; // that one's argument is the wasm itself
    // A transaction succeeded only if its own status and every receipt did.
    const failure = [r.status, ...r.receipts_outcome.map((o: any) => o.outcome.status)].find((s: any) => s.Failure)?.Failure;
    const panic = failure ? JSON.stringify(failure).match(/"ExecutionError":"([^"]*)"/)?.[1] ?? JSON.stringify(failure).slice(0, 120) : '';
    const result = failure ? `failure (${panic})` : 'success';
    const resultOk = row.result === 'success' ? !failure : !!failure && panic.includes(row.result);
    const wrong = [
      t.signer_id !== row.signer && `signer: expected ${row.signer}`,
      t.receiver_id !== row.receiver && `receiver: expected ${row.receiver}`,
      method !== row.method && `method: expected ${row.method}`,
      !resultOk && `result: expected ${row.result}`,
      ...(row.args ?? []).filter((a) => !args.includes(a)).map((a) => `args: expected ${a}`),
    ].filter(Boolean);
    if (wrong.length) diffs++;
    console.log(`${wrong.length ? 'DIFF' : 'ok  '} ${row.hash.slice(0, 8)}  ${row.what}\n     signer ${t.signer_id}  receiver ${t.receiver_id}\n     method ${method}  result ${result}${wrong.length ? `\n     ${wrong.join('; ')}` : ''}`);
  } catch (e: any) {
    diffs++;
    console.log(`DIFF ${row.hash.slice(0, 8)}  ${row.what}\n     could not be read: ${e.message}`);
  }
}
console.log(diffs ? `\n${diffs} of ${ROWS.length} transactions differ or could not be read` : `\n${ROWS.length} of ${ROWS.length} transactions match`);
process.exit(diffs ? 1 : 0);
