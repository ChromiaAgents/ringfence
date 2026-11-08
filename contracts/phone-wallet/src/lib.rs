// Phone wallet: one instance per user, on a sub-account of the user (e.g. phone.alice.testnet).
// The owner (the user's main account) has full control. The agent (callhand's server account) may only spend
// within the limits below; every limit is checked here, not by the AI.
//
// Assets: "near" (native transfers) and "eth:sepolia" (Chain Signatures: the contract asks the MPC signer to sign an
// EIP-1559 transfer it has parsed itself, so the value and recipient it limits are the ones that get signed).
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use std::collections::HashMap;

const DAY_NS: u64 = 86_400_000_000_000;
const SIGN_GAS: Gas = Gas::from_tgas(50);
pub const ETH_PATH: &str = "ethereum-1";
const SEPOLIA_CHAIN_ID: u64 = 11_155_111;

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
    /// For "eth:sepolia": the unsigned EIP-1559 transaction (hex) to sign once ready.
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
    allowlist: Vec<String>,
    new_recipient_delay_sec: u64,
    day: u64,
    spent: HashMap<String, u128>,
    pending: Vec<Pending>,
    next_id: u64,
}

#[near(serializers = [json])]
pub struct State {
    pub owner: AccountId,
    pub agent: Option<AccountId>,
    pub phone_hash: String,
    pub signer: AccountId,
    pub limits: HashMap<String, Limit>,
    pub allowlist: Vec<String>,
    pub new_recipient_delay_sec: u64,
    pub day: u64,
    pub spent_today: HashMap<String, U128>,
    pub pending: Vec<Pending>,
    pub balance: U128,
}

#[near]
impl PhoneWallet {
    /// Defaults: 5 NEAR per transfer, 10 NEAR per day; 0.01 ETH per transfer, 0.02 ETH per day on Sepolia.
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, phone_hash: String, signer: Option<AccountId>) -> Self {
        require!(agent != owner, "the agent can't be the owner");
        let e18 = 10u128.pow(18);
        let e24 = 10u128.pow(24);
        let mut limits = HashMap::new();
        limits.insert("near".into(), Limit { per_tx: U128(5 * e24), per_day: U128(10 * e24) });
        limits.insert("eth:sepolia".into(), Limit { per_tx: U128(e18 / 100), per_day: U128(e18 / 50) });
        Self {
            owner, agent: Some(agent), phone_hash,
            signer: signer.unwrap_or_else(|| "v1.signer-prod.testnet".parse().unwrap()),
            limits, allowlist: vec![], new_recipient_delay_sec: 600,
            day: 0, spent: HashMap::new(), pending: vec![], next_id: 0,
        }
    }

    // ---- owner ----

    #[payable]
    pub fn set_limits(&mut self, asset: String, per_tx: U128, per_day: U128) {
        self.only_owner();
        self.limits.insert(asset, Limit { per_tx, per_day });
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
    pub fn request_signature(&mut self, chain: String, tx: String) -> PromiseOrValue<U64> {
        self.only_agent();
        require!(chain == "eth:sepolia", "only eth:sepolia is supported");
        let bytes = hex::decode(tx.trim_start_matches("0x")).unwrap_or_else(|_| env::panic_str("tx is not hex"));
        let (to, value) = parse_eip1559(&bytes, SEPOLIA_CHAIN_ID);
        self.check_tx(&chain, value);
        if !self.allowed(&to) { return PromiseOrValue::Value(U64(self.queue(&chain, to, U128(value), Some(tx)))); }
        self.spend(&chain, value);
        PromiseOrValue::Promise(self.sign(&bytes))
    }

    /// Runs a queued transfer once its delay has passed. Day limits are checked again now.
    pub fn execute(&mut self, pending_id: u64) -> PromiseOrValue<U64> {
        require!(self.agent.as_ref() == Some(&env::predecessor_account_id()) || env::predecessor_account_id() == self.owner, "only the agent or the owner");
        let i = self.pending.iter().position(|p| p.id == pending_id).unwrap_or_else(|| env::panic_str("no such pending transfer"));
        require!(env::block_timestamp() >= self.pending[i].ready_at_ns.0, "new recipient: still in the waiting period");
        let p = self.pending.remove(i);
        self.check_tx(&p.asset, p.amount.0);
        self.spend(&p.asset, p.amount.0);
        match p.tx {
            None => { let _ = Promise::new(p.to.parse::<AccountId>().unwrap()).transfer(NearToken::from_yoctonear(p.amount.0)); PromiseOrValue::Value(U64(p.id)) }
            Some(tx) => PromiseOrValue::Promise(self.sign(&hex::decode(tx.trim_start_matches("0x")).unwrap())),
        }
    }

    // ---- view ----

    pub fn get_state(&self) -> State {
        let today = env::block_timestamp() / DAY_NS;
        State {
            owner: self.owner.clone(), agent: self.agent.clone(), phone_hash: self.phone_hash.clone(), signer: self.signer.clone(),
            limits: self.limits.clone(), allowlist: self.allowlist.clone(), new_recipient_delay_sec: self.new_recipient_delay_sec,
            day: today,
            spent_today: if self.day == today { self.spent.iter().map(|(k, v)| (k.clone(), U128(*v))).collect() } else { HashMap::new() },
            pending: self.pending.clone(),
            balance: U128(env::account_balance().as_yoctonear()),
        }
    }

    // ---- internal ----

    fn only_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }
    fn only_agent(&self) {
        require!(self.agent.as_ref() == Some(&env::predecessor_account_id()), "only the agent");
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
    pub const TX: &str = "02f183aa36a707843b9aca00847735940082520894111111111111111111111111111111111111111187038d7ea4c6800080c0";

    fn ctx(who: usize, t_sec: u64, deposit: u128) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(who)).block_timestamp(t_sec * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100)).build());
    }
    // owner = alice (0), agent = bob (1)
    fn wallet() -> PhoneWallet { ctx(0, 1000, 0); PhoneWallet::new(accounts(0), accounts(1), "h".into(), None) }

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
        let (to, value) = parse_eip1559(&hex::decode(TX).unwrap(), SEPOLIA_CHAIN_ID);
        assert_eq!(to, "0x1111111111111111111111111111111111111111");
        assert_eq!(value, 10u128.pow(15));
    }
    #[test]
    #[should_panic(expected = "wrong chain id")]
    fn rejects_other_chain() { parse_eip1559(&hex::decode(TX).unwrap(), 1); }
    #[test]
    #[should_panic(expected = "over the per-transfer limit for eth:sepolia")]
    fn eth_limit_from_parsed_value() {
        let mut w = wallet();
        ctx(0, 1000, 1); w.set_limits("eth:sepolia".into(), U128(10u128.pow(14)), U128(10u128.pow(18)));
        ctx(1, 1000, 0); w.request_signature("eth:sepolia".into(), TX.into());
    }
    #[test]
    fn eth_new_recipient_is_queued() {
        let mut w = wallet();
        ctx(1, 1000, 0);
        assert!(matches!(w.request_signature("eth:sepolia".into(), TX.into()), PromiseOrValue::Value(U64(0))));
    }
}
