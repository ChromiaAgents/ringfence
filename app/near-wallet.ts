// Wallet selector for the phone-wallet pages (network from the server's NETWORK). Browser only: modules load on demand, as on the launch page.
import { useEffect, useRef, useState } from 'react';

export function useNearWallet(description: string, network: 'mainnet' | 'testnet' = 'testnet') {
  const [account, setAccount] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const ws = useRef<{ selector?: any; modal?: any }>({});
  useEffect(() => {
    let off: any;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupHotWallet }, { setupMyNearWallet }, { setupIntearWallet }] = await Promise.all([
        import('@near-wallet-selector/core'), import('@near-wallet-selector/modal-ui'), import('@near-wallet-selector/meteor-wallet'),
        import('@near-wallet-selector/hot-wallet'), import('@near-wallet-selector/my-near-wallet'), import('@near-wallet-selector/intear-wallet'),
      ]);
      const selector = await setupWalletSelector({ network, modules: [setupMeteorWallet(), setupHotWallet(), setupIntearWallet(), setupMyNearWallet()] });
      ws.current = { selector, modal: setupModal(selector, { description }) };
      const sync = (s: any) => setAccount(s.accounts.find((a: any) => a.active)?.accountId ?? null);
      sync(selector.store.getState());
      off = selector.store.observable.subscribe(sync);
    })().catch((e) => setErr(`Wallet selector failed to load: ${e.message}`));
    return () => off?.unsubscribe?.();
  }, [network]);
  /** Signs and sends one transaction from the connected account; returns its hash. */
  async function send(receiverId: string, actions: (ac: any) => unknown[]) {
    const actionCreators = await browserActions();
    const wallet = await ws.current.selector.wallet();
    const out = await wallet.signAndSendTransaction({ signerId: account, receiverId, actions: actions(actionCreators) });
    return (out?.transaction?.hash ?? out?.transaction_outcome?.id) as string | undefined;
  }
  return { account, err, setErr, connect: () => ws.current.modal?.show(), send };
}

/** The wallet library encodes function-call args with Node's Buffer, which browsers don't have ("Buffer is not
 *  defined"). Hand it bytes instead: it passes a Uint8Array through untouched. */
export async function browserActions() {
  const { actionCreators } = await import('@near-wallet-selector/core');
  const bytes = (args: unknown) => (args instanceof Uint8Array ? args : new TextEncoder().encode(JSON.stringify(args ?? {})));
  return { ...actionCreators, functionCall: (method: string, args: unknown, gas?: bigint, deposit?: bigint) => actionCreators.functionCall(method, bytes(args), gas, deposit) };
}
