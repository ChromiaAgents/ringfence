// Phone wallet: one instance per user, on a sub-account of the user (e.g. phone.alice.testnet).
// The owner (the user's main account) has full control. The agent (Ringfence's server account) may only spend
// within the limits below; every limit is checked here, not by the AI.
//
// Assets: "near" (native transfers) and "evm:<chainId>" for any EVM chain the owner allows (Chain Signatures: the
// contract asks the MPC signer to sign an EIP-1559 transfer it has parsed itself, so the chain, value and recipient it
// limits are the ones that get signed). One path ("ethereum-1") gives the same address on every EVM chain.
// UNAUDITED PROTOTYPE: keep small amounts.
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use std::collections::HashMap;

const DAY_NS: u64 = 86_400_000_000_000;
const SIGN_GAS: Gas = Gas::from_tgas(50);
pub const ETH_PATH: &str = "ethereum-1";
pub const BASE_CHAIN_ID: u64 = 8453;
pub fn evm_key(chain_id: u64) -> String { format!("evm:{chain_id}") }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Limit { pub per_tx: U128, pub per_day: U128 }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub id: u64,
    pub asset: String,
    pub to: String,
    pub amount: U128,
    pub ready_at_ns: U64,
    /// For "evm:<id>": the unsigned EIP-1559 transaction (hex) to sign once ready.
    pub tx: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PhoneWallet {
    owner: AccountId,
    agent: Option<AccountId>,
    /// sha256 of the WhatsApp number (digits only). The owner signs it at init, so the server can check that
    /// a phone number really was bound to this contract by its owner.
    phone_hash: String,
    signer: AccountId,
    limits: HashMap<String, Limit>,
    /// EVM chain ids the agent may ask signatures for (each also needs a limit "evm:<id>").
    chains: Vec<u64>,
    allowlist: Vec<String>,
    new_recipient_delay_sec: u64,
    day: u64,
    spent: HashMap<String, u128>,
    pending: Vec<Pending>,
    next_id: u64,
    /// Two-step ownership transfer (custodial claim): the owner proposes, the new account accepts.
    pending_owner: Option<AccountId>,
    /// Agent spends are refused until this time (ns). The owner's own actions are never frozen.
    frozen_until_ns: u64,
}

#[near(serializers = [json])]
pub struct State {
    pub owner: AccountId,
    pub agent: Option<AccountId>,
    pub phone_hash: String,
    pub signer: AccountId,
    pub limits: HashMap<String, Limit>,
    pub chains: Vec<u64>,
    pub allowlist: Vec<String>,
    pub new_recipient_delay_sec: u64,
    pub day: u64,
    pub spent_today: HashMap<String, U128>,
    pub pending: Vec<Pending>,
    pub balance: U128,
    pub pending_owner: Option<AccountId>,
    pub frozen_until_ns: U64,
}

#[near]
impl PhoneWallet {
    /// Defaults (mainnet-safe): 0.2 NEAR per transfer, 0.5 NEAR per day; on each EVM chain in `evm_chain_ids` (default
    /// [8453] = Base) 0.0005 per transfer, 0.002 per day in that chain's native units; new recipients wait 600 s.
    /// Every default can be overridden here at bind time, and later by the owner.
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, phone_hash: String, signer: Option<AccountId>, evm_chain_ids: Option<Vec<u64>>,
               near_limit: Option<Limit>, evm_limit: Option<Limit>, new_recipient_delay_sec: Option<u64>,
               recipients: Option<Vec<String>>) -> Self {
        require!(agent != owner, "the agent can't be the owner");
        let e18 = 10u128.pow(18);
        let e24 = 10u128.pow(24);
        let chains = evm_chain_ids.unwrap_or_else(|| vec![BASE_CHAIN_ID]);
        let evm = evm_limit.unwrap_or(Limit { per_tx: U128(e18 / 2000), per_day: U128(e18 / 500) });
        let mut limits = HashMap::new();
        limits.insert("near".into(), near_limit.unwrap_or(Limit { per_tx: U128(e24 / 5), per_day: U128(e24 / 2) }));
        for c in &chains { limits.insert(evm_key(*c), evm.clone()); }
        Self {
            owner, agent: Some(agent), phone_hash,
            signer: signer.unwrap_or_else(|| "v1.signer".parse().unwrap()),
            limits, chains, allowlist: recipients.unwrap_or_default().iter().map(|r| r.to_lowercase()).collect(), new_recipient_delay_sec: new_recipient_delay_sec.unwrap_or(600),
            day: 0, spent: HashMap::new(), pending: vec![], next_id: 0, pending_owner: None, frozen_until_ns: 0,
        }
    }

    // ---- owner ----

    #[payable]
    pub fn set_limits(&mut self, asset: String, per_tx: U128, per_day: U128) {
        self.only_owner();
        self.limits.insert(asset, Limit { per_tx, per_day });
    }
    /// Lets the agent use an EVM chain, with its limits (native units of that chain, e.g. wei).
    #[payable]
    pub fn allow_chain(&mut self, chain_id: u64, per_tx: U128, per_day: U128) {
        self.only_owner();
        if !self.chains.contains(&chain_id) { self.chains.push(chain_id); }
        self.limits.insert(evm_key(chain_id), Limit { per_tx, per_day });
    }
    #[payable]
    pub fn disallow_chain(&mut self, chain_id: u64) {
        self.only_owner();
        self.chains.retain(|c| *c != chain_id);
        self.limits.remove(&evm_key(chain_id));
    }
    #[payable]
    pub fn set_delay(&mut self, new_recipient_delay_sec: u64) {
        self.only_owner();
        self.new_recipient_delay_sec = new_recipient_delay_sec;
    }
    #[payable]
    pub fn allow(&mut self, recipient: String) {
        self.only_owner();
        let r = recipient.to_lowercase();
        if !self.allowlist.contains(&r) { self.allowlist.push(r); }
    }
    #[payable]
    pub fn disallow(&mut self, recipient: String) {
        self.only_owner();
        let r = recipient.to_lowercase();
        self.allowlist.retain(|x| *x != r);
    }
    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) {
        self.only_owner();
        require!(agent != self.owner, "the agent can't be the owner");
        self.agent = Some(agent);
    }
    /// Step 1 of handing the wallet over (e.g. custody -> the family's own account). The agent can never become owner.
    #[payable]
    pub fn propose_owner(&mut self, new_owner: AccountId) {
        self.only_owner();
        require!(Some(&new_owner) != self.agent.as_ref(), "the agent can't be the owner");
        self.pending_owner = Some(new_owner);
    }
    /// Step 2: the proposed account accepts.
    pub fn accept_owner(&mut self) {
        let me = env::predecessor_account_id();
        require!(self.pending_owner.as_ref() == Some(&me), "not the proposed owner");
        require!(Some(&me) != self.agent.as_ref(), "the agent can't be the owner");
        self.owner = me;
        self.pending_owner = None;
    }
    #[payable]
    pub fn cancel_owner_transfer(&mut self) {
        self.only_owner();
        self.pending_owner = None;
    }
    /// Blocks every agent spend until `until_ts` (unix seconds). Used by the Reject button.
    #[payable]
    pub fn freeze(&mut self, until_ts: U64) {
        self.only_owner();
        self.frozen_until_ns = until_ts.0.saturating_mul(1_000_000_000);
    }
    #[payable]
    pub fn unfreeze(&mut self) {
        self.only_owner();
        self.frozen_until_ns = 0;
    }
    #[payable]
    pub fn revoke_agent(&mut self) {
        self.only_owner();
        self.agent = None;
    }
    /// Always works, whatever the agent does: there is no agent-side lock on the owner's money.
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.only_owner();
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }
    #[payable]
    pub fn cancel(&mut self, pending_id: u64) {
        self.only_owner();
        let n = self.pending.len();
        self.pending.retain(|p| p.id != pending_id);
        require!(self.pending.len() < n, "no such pending transfer");
    }

    // ---- agent ----

    /// Sends now if `to` is allowlisted; otherwise queues it and returns the pending id (run it later with `execute`).
    pub fn transfer_near(&mut self, to: AccountId, amount: U128) -> Option<u64> {
        self.only_agent();
        self.check_tx("near", amount.0);
        if !self.allowed(to.as_str()) { return Some(self.queue("near", to.to_string(), amount, None)); }
        self.spend("near", amount.0);
        let _ = Promise::new(to).transfer(NearToken::from_yoctonear(amount.0));
        None
    }

    /// `tx` is an unsigned EIP-1559 transfer (hex, 0x02 || rlp([...])). The contract reads chain id, recipient and
    /// value from it, refuses contract calls (non-empty data), applies the limits, then asks the MPC signer to sign
    /// keccak256(tx) on path "ethereum-1". The signer's response is this call's return value.
    /// `chain` is "evm:<chainId>"; the chain must be allowed by the owner, have a limit, and match the tx's chain id.
    pub fn request_signature(&mut self, chain: String, tx: String) -> PromiseOrValue<U64> {
        self.only_agent();
        let id: u64 = chain.strip_prefix("evm:").and_then(|x| x.parse().ok()).unwrap_or_else(|| env::panic_str("chain must be evm:<chainId>"));
        require!(self.chains.contains(&id), format!("chain {id} is not allowed by the owner"));
        let bytes = hex::decode(tx.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str("tx is not hex"));
        let (to, value) = parse_eip1559(&bytes, id);
        self.check_tx(&chain, value);
        if !self.allowed(&to) { return PromiseOrValue::Value(U64(self.queue(&chain, to, U128(value), Some(tx)))); }
        self.spend(&chain, value);
        PromiseOrValue::Promise(self.sign(&bytes))
    }

    /// Runs a queued transfer once its delay has passed. Day limits are checked again now.
    pub fn execute(&mut self, pending_id: u64) -> PromiseOrValue<U64> {
        if env::predecessor_account_id() != self.owner { self.only_agent(); }
        let i = self.pending.iter().position(|p| p.id == pending_id).unwrap_or_else(|| env::panic_str("no such pending transfer"));
        require!(env::block_timestamp() >= self.pending[i].ready_at_ns.0, "new recipient: still in the waiting period");
        let p = self.pending.remove(i);
        self.check_tx(&p.asset, p.amount.0);
        self.spend(&p.asset, p.amount.0);
        match p.tx {
            None => { let _ = Promise::new(p.to.parse::<AccountId>().unwrap()).transfer(NearToken::from_yoctonear(p.amount.0)); PromiseOrValue::Value(U64(p.id)) }
            Some(tx) => {
                let id: u64 = p.asset.strip_prefix("evm:").and_then(|x| x.parse().ok()).unwrap();
                require!(self.chains.contains(&id), format!("chain {id} is not allowed by the owner"));
                PromiseOrValue::Promise(self.sign(&hex::decode(tx.trim_start_matches("0x")).unwrap()))
            }
        }
    }

    // ---- view ----

    pub fn get_state(&self) -> State {
        let today = env::block_timestamp() / DAY_NS;
        State {
            owner: self.owner.clone(), agent: self.agent.clone(), phone_hash: self.phone_hash.clone(), signer: self.signer.clone(),
            limits: self.limits.clone(), chains: self.chains.clone(), allowlist: self.allowlist.clone(), new_recipient_delay_sec: self.new_recipient_delay_sec,
            day: today,
            spent_today: if self.day == today { self.spent.iter().map(|(k, v)| (k.clone(), U128(*v))).collect() } else { HashMap::new() },
            pending: self.pending.clone(),
            balance: U128(env::account_balance().as_yoctonear()),
            pending_owner: self.pending_owner.clone(), frozen_until_ns: U64(self.frozen_until_ns),
        }
    }

    // ---- internal ----

    fn only_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }
    fn only_agent(&self) {
        require!(self.agent.as_ref() == Some(&env::predecessor_account_id()), "only the agent");
        require!(env::block_timestamp() >= self.frozen_until_ns, "frozen by the owner");
    }
    fn allowed(&self, to: &str) -> bool { self.allowlist.contains(&to.to_lowercase()) }
    fn limit(&self, asset: &str) -> Limit {
        self.limits.get(asset).cloned().unwrap_or_else(|| env::panic_str(&format!("no limit set for {asset}")))
    }
    fn spent_today(&self, asset: &str) -> u128 {
        if self.day == env::block_timestamp() / DAY_NS { *self.spent.get(asset).unwrap_or(&0) } else { 0 }
    }
    fn check_tx(&self, asset: &str, amount: u128) {
        let l = self.limit(asset);
        require!(amount > 0, "amount must be above zero");
        require!(amount <= l.per_tx.0, format!("over the per-transfer limit for {asset}: {} > {}", amount, l.per_tx.0));
        require!(self.spent_today(asset) + amount <= l.per_day.0, format!("over the daily limit for {asset}: {} spent today, {} more asked, limit {}", self.spent_today(asset), amount, l.per_day.0));
    }
    fn spend(&mut self, asset: &str, amount: u128) {
        let today = env::block_timestamp() / DAY_NS;
        if self.day != today { self.day = today; self.spent.clear(); }
        *self.spent.entry(asset.to_string()).or_insert(0) += amount;
    }
    fn queue(&mut self, asset: &str, to: String, amount: U128, tx: Option<String>) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let ready_at_ns = U64(env::block_timestamp() + self.new_recipient_delay_sec * 1_000_000_000);
        self.pending.push(Pending { id, asset: asset.into(), to: to.to_lowercase(), amount, ready_at_ns, tx });
        env::log_str(&format!("queued {id}: new recipient, runs after {}s unless the owner cancels", self.new_recipient_delay_sec));
        id
    }
    fn sign(&self, tx: &[u8]) -> Promise {
        let args = format!(r#"{{"request":{{"path":"{}","payload_v2":{{"Ecdsa":"{}"}},"domain_id":0}}}}"#, ETH_PATH, hex::encode(env::keccak256(tx)));
        Promise::new(self.signer.clone()).function_call("sign", args.into_bytes(), NearToken::from_yoctonear(1), SIGN_GAS)
    }
}

// ---- minimal RLP: just enough to read a plain EIP-1559 transfer ----

/// Returns (payload, rest, is_list) for the first RLP item in `b`.
fn rlp_item(b: &[u8]) -> (&[u8], &[u8], bool) {
    require!(!b.is_empty(), "bad rlp");
    let p = b[0] as usize;
    let (start, len, list) = match p {
        0x00..=0x7f => (0, 1, false),
        0x80..=0xb7 => (1, p - 0x80, false),
        0xb8..=0xbf => { let n = p - 0xb7; (1 + n, be(&b[1..1 + n]) as usize, false) }
        0xc0..=0xf7 => (1, p - 0xc0, true),
        _ => { let n = p - 0xf7; (1 + n, be(&b[1..1 + n]) as usize, true) }
    };
    require!(b.len() >= start + len, "bad rlp length");
    (&b[start..start + len], &b[start + len..], list)
}
fn be(b: &[u8]) -> u128 {
    require!(b.len() <= 16, "number too large");
    b.iter().fold(0u128, |a, x| (a << 8) | *x as u128)
}

/// 0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gas, to, value, data, accessList]) → ("0x…to", value).
pub fn parse_eip1559(tx: &[u8], chain_id: u64) -> (String, u128) {
    require!(tx.first() == Some(&2), "not an EIP-1559 transaction");
    let (body, rest, list) = rlp_item(&tx[1..]);
    require!(list && rest.is_empty(), "bad transaction");
    let mut f = Vec::new();
    let mut b = body;
    while !b.is_empty() { let (x, r, l) = rlp_item(b); f.push((x, l)); b = r; }
    require!(f.len() == 9, "unsigned EIP-1559 transactions have 9 fields");
    require!(be(f[0].0) == chain_id as u128, "wrong chain id");
    require!(f[5].0.len() == 20, "recipient must be an address");
    require!(f[7].0.is_empty(), "plain transfers only: no contract calls");
    require!(f[8].1 && f[8].0.is_empty(), "no access list");
    (format!("0x{}", hex::encode(f[5].0)), be(f[6].0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const NEAR: u128 = 10u128.pow(24);
    // Built by ethers in test/wallet (same fields): Sepolia, nonce 7, 0.001 ETH to 0x1111…1111, 21000 gas.
    pub const SEPOLIA: u64 = 11_155_111;
    pub const TX: &str = "02f183aa36a707843b9aca00847735940082520894111111111111111111111111111111111111111187038d7ea4c6800080c0";

    fn ctx(who: usize, t_sec: u64, deposit: u128) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(who)).block_timestamp(t_sec * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100)).build());
    }
    // owner = alice (0), agent = bob (1)
    // Same, on Base (8453), 0.0001 ETH.
    pub const BASE_TX: &str = "02ef82210507843b9aca008477359400825208941111111111111111111111111111111111111111865af3107a400080c0";
    // Testnet-like wallet: Sepolia allowed, old-style 5/10 NEAR limits so the NEAR tests keep their numbers.
    fn wallet() -> PhoneWallet {
        ctx(0, 1000, 0);
        PhoneWallet::new(accounts(0), accounts(1), "h".into(), None, Some(vec![SEPOLIA]),
            Some(Limit { per_tx: U128(5 * NEAR), per_day: U128(10 * NEAR) }), Some(Limit { per_tx: U128(10u128.pow(16)), per_day: U128(2 * 10u128.pow(16)) }), None, None)
    }
    fn mainnet_wallet() -> PhoneWallet { ctx(0, 1000, 0); PhoneWallet::new(accounts(0), accounts(1), "h".into(), None, None, None, None, None, None) }

    #[test]
    fn limits_and_allowlist() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.allow("Charlie".into());
        ctx(1, 1000, 0);
        assert_eq!(w.transfer_near(accounts(2), U128(4 * NEAR)), None); // allowlisted: instant
        assert_eq!(w.get_state().spent_today["near"].0, 4 * NEAR);
        assert_eq!(w.transfer_near(accounts(3), U128(1 * NEAR)), Some(0)); // new recipient: queued
        assert_eq!(w.get_state().pending.len(), 1);
    }
    #[test]
    #[should_panic(expected = "over the per-transfer limit")]
    fn per_tx_limit() { let mut w = wallet(); ctx(1, 1000, 0); w.transfer_near(accounts(2), U128(6 * NEAR)); }
    #[test]
    #[should_panic(expected = "over the daily limit")]
    fn per_day_limit() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.allow("charlie".into());
        ctx(1, 1000, 0); w.transfer_near(accounts(2), U128(5 * NEAR)); w.transfer_near(accounts(2), U128(5 * NEAR));
        w.transfer_near(accounts(2), U128(1));
    }
    #[test]
    fn day_rollover() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.allow("charlie".into());
        ctx(1, 1000, 0); w.transfer_near(accounts(2), U128(5 * NEAR)); w.transfer_near(accounts(2), U128(5 * NEAR));
        ctx(1, 1000 + 86_400, 0);
        assert!(w.get_state().spent_today.is_empty());
        w.transfer_near(accounts(2), U128(5 * NEAR));
        assert_eq!(w.get_state().spent_today["near"].0, 5 * NEAR);
    }
    #[test]
    fn delay_queue_then_execute() {
        let mut w = wallet();
        ctx(1, 1000, 0); let id = w.transfer_near(accounts(3), U128(NEAR)).unwrap();
        ctx(1, 1000 + 600, 0); w.execute(id);
        assert!(w.get_state().pending.is_empty());
        assert_eq!(w.get_state().spent_today["near"].0, NEAR);
    }
    #[test]
    #[should_panic(expected = "still in the waiting period")]
    fn delay_not_over() { let mut w = wallet(); ctx(1, 1000, 0); let id = w.transfer_near(accounts(3), U128(NEAR)).unwrap(); ctx(1, 1599, 0); w.execute(id); }
    #[test]
    #[should_panic(expected = "no such pending")]
    fn owner_cancels() {
        let mut w = wallet();
        ctx(1, 1000, 0); let id = w.transfer_near(accounts(3), U128(NEAR)).unwrap();
        ctx(0, 1000, 1); w.cancel(id);
        ctx(1, 2000, 0); w.execute(id);
    }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cant_set_limits() { let mut w = wallet(); ctx(1, 1000, 1); w.set_limits("near".into(), U128(1000 * NEAR), U128(1000 * NEAR)); }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cant_withdraw() { let mut w = wallet(); ctx(1, 1000, 1); w.withdraw(U128(1)); }
    #[test]
    #[should_panic(expected = "only the agent")]
    fn revoked_agent_cant_spend() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.revoke_agent();
        ctx(1, 1000, 0); w.transfer_near(accounts(2), U128(1));
    }
    #[test]
    #[should_panic(expected = "the agent can't be the owner")]
    fn agent_is_never_owner() { let mut w = wallet(); ctx(0, 1000, 1); w.set_agent(accounts(0)); }
    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn owner_methods_need_one_yocto() { let mut w = wallet(); ctx(0, 1000, 0); w.allow("x".into()); }

    #[test]
    fn parses_eip1559_transfer() {
        let (to, value) = parse_eip1559(&hex::decode(TX).unwrap(), SEPOLIA);
        assert_eq!(to, "0x1111111111111111111111111111111111111111");
        assert_eq!(value, 10u128.pow(15));
    }
    #[test]
    #[should_panic(expected = "wrong chain id")]
    fn rejects_other_chain() { parse_eip1559(&hex::decode(TX).unwrap(), 1); }
    #[test]
    #[should_panic(expected = "over the per-transfer limit for evm:11155111")]
    fn eth_limit_from_parsed_value() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.set_limits("evm:11155111".into(), U128(10u128.pow(14)), U128(10u128.pow(18)));
        ctx(1, 1000, 0); w.request_signature("evm:11155111".into(), TX.into());
    }
    #[test]
    fn eth_new_recipient_is_queued() {
        let mut w = wallet();
        ctx(1, 1000, 0);
        assert!(matches!(w.request_signature("evm:11155111".into(), TX.into()), PromiseOrValue::Value(U64(0))));
    }

    #[test]
    fn mainnet_defaults() {
        let w = mainnet_wallet();
        let s = w.get_state();
        assert_eq!(s.signer.as_str(), "v1.signer");
        assert_eq!(s.chains, vec![8453]);
        assert_eq!(s.limits["near"], Limit { per_tx: U128(NEAR / 5), per_day: U128(NEAR / 2) });
        assert_eq!(s.limits["evm:8453"], Limit { per_tx: U128(5 * 10u128.pow(14)), per_day: U128(2 * 10u128.pow(15)) });
        assert_eq!(s.new_recipient_delay_sec, 600);
    }
    #[test]
    fn base_tx_parses_and_queues() {
        let (to, value) = parse_eip1559(&hex::decode(BASE_TX).unwrap(), 8453);
        assert_eq!(to, "0x1111111111111111111111111111111111111111");
        assert_eq!(value, 10u128.pow(14));
        let mut w = mainnet_wallet();
        ctx(1, 1000, 0);
        assert!(matches!(w.request_signature("evm:8453".into(), BASE_TX.into()), PromiseOrValue::Value(U64(0))));
    }
    #[test]
    #[should_panic(expected = "chain 11155111 is not allowed")]
    fn chain_not_allowed() { let mut w = mainnet_wallet(); ctx(1, 1000, 0); w.request_signature("evm:11155111".into(), TX.into()); }
    #[test]
    #[should_panic(expected = "wrong chain id")]
    fn chain_key_must_match_tx() { let mut w = mainnet_wallet(); ctx(1, 1000, 0); w.request_signature("evm:8453".into(), TX.into()); }
    #[test]
    fn owner_allows_and_disallows_chain() {
        let mut w = mainnet_wallet();
        ctx(0, 1000, 1); w.allow_chain(42161, U128(1), U128(2));
        assert!(w.get_state().chains.contains(&42161));
        assert_eq!(w.get_state().limits["evm:42161"].per_day.0, 2);
        w.disallow_chain(42161);
        assert!(!w.get_state().chains.contains(&42161));
        assert!(!w.get_state().limits.contains_key("evm:42161"));
    }
    #[test]
    #[should_panic(expected = "no limit set for evm:8453")]
    fn allowed_chain_without_limit_refused() {
        let mut w = mainnet_wallet();
        ctx(0, 1000, 1); w.limits.remove("evm:8453");
        ctx(1, 1000, 0); w.request_signature("evm:8453".into(), BASE_TX.into());
    }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cant_allow_chain() { let mut w = mainnet_wallet(); ctx(1, 1000, 1); w.allow_chain(1, U128(1), U128(1)); }

    #[test]
    fn recipients_at_init_are_allowlisted() {
        ctx(0, 1000, 0);
        let mut w = PhoneWallet::new(accounts(0), accounts(1), "h".into(), None, None, None, None, None, Some(vec!["Charlie".into()]));
        ctx(1, 1000, 0);
        assert_eq!(w.transfer_near(accounts(2), U128(NEAR / 10)), None);
    }
    #[test]
    fn claim_propose_accept() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.propose_owner(accounts(3));
        assert_eq!(w.get_state().pending_owner, Some(accounts(3)));
        ctx(3, 1000, 0); w.accept_owner();
        let s = w.get_state();
        assert_eq!(s.owner, accounts(3));
        assert_eq!(s.pending_owner, None);
        ctx(3, 1000, 1); w.withdraw(U128(1)); // the new owner has control
    }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn old_owner_loses_control_after_claim() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.propose_owner(accounts(3));
        ctx(3, 1000, 0); w.accept_owner();
        ctx(0, 1000, 1); w.withdraw(U128(1));
    }
    #[test]
    #[should_panic(expected = "not the proposed owner")]
    fn cancelled_claim_cant_be_accepted() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.propose_owner(accounts(3)); w.cancel_owner_transfer();
        ctx(3, 1000, 0); w.accept_owner();
    }
    #[test]
    #[should_panic(expected = "not the proposed owner")]
    fn stranger_cant_accept() { let mut w = wallet(); ctx(0, 1000, 1); w.propose_owner(accounts(3)); ctx(4, 1000, 0); w.accept_owner(); }
    #[test]
    #[should_panic(expected = "the agent can't be the owner")]
    fn agent_cant_be_proposed() { let mut w = wallet(); ctx(0, 1000, 1); w.propose_owner(accounts(1)); }
    #[test]
    #[should_panic(expected = "the agent can't be the owner")]
    fn agent_set_after_proposal_cant_accept() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.propose_owner(accounts(3)); w.set_agent(accounts(3));
        ctx(3, 1000, 0); w.accept_owner();
    }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cant_propose() { let mut w = wallet(); ctx(1, 1000, 1); w.propose_owner(accounts(1)); }
    #[test]
    #[should_panic(expected = "frozen by the owner")]
    fn freeze_blocks_agent() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.allow("charlie".into()); w.freeze(U64(2000));
        ctx(1, 1999, 0); w.transfer_near(accounts(2), U128(1));
    }
    #[test]
    fn freeze_ends_and_unfreeze() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.allow("charlie".into()); w.freeze(U64(2000));
        ctx(1, 2000, 0); assert_eq!(w.transfer_near(accounts(2), U128(1)), None); // freeze over
        ctx(0, 2000, 1); w.freeze(U64(9999)); w.unfreeze();
        ctx(1, 2001, 0); assert_eq!(w.transfer_near(accounts(2), U128(1)), None);
    }
    #[test]
    #[should_panic(expected = "frozen by the owner")]
    fn freeze_blocks_agent_execute() {
        let mut w = wallet();
        ctx(1, 1000, 0); let id = w.transfer_near(accounts(3), U128(NEAR)).unwrap();
        ctx(0, 1000, 1); w.freeze(U64(5000));
        ctx(1, 2000, 0); w.execute(id);
    }
    #[test]
    fn owner_works_while_frozen() {
        let mut w = wallet();
        ctx(1, 1000, 0); let id = w.transfer_near(accounts(3), U128(NEAR)).unwrap();
        ctx(0, 1000, 1); w.freeze(U64(5000)); w.withdraw(U128(1));
        ctx(0, 2000, 0); w.execute(id); // the owner may still run a queued transfer
    }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cant_unfreeze() { let mut w = wallet(); ctx(1, 1000, 1); w.unfreeze(); }
}
