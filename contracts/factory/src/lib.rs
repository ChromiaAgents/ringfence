// Wallet factory at ringfence-wallet.near: one phone wallet per phone number, on <id>.ringfence-wallet.near.
// The phone-wallet wasm is uploaded once as a NEAR global contract (NEP-591, by code hash); each new wallet only
// references it, so a wallet costs its account storage, not a copy of the code.
// UNAUDITED PROTOTYPE: keep small amounts.
use near_sdk::json_types::{Base58CryptoHash, U128};
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

/// Left on the new wallet account for its storage (account + state, about 0.6 KB measured, see tests/sandbox.rs).
pub const WALLET_STORAGE: NearToken = NearToken::from_millinear(10);
/// Charged on top for the factory's own two map entries.
pub const FACTORY_STORAGE: NearToken = NearToken::from_millinear(3);
const INIT_GAS: Gas = Gas::from_tgas(20);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [json])]
pub struct Limit { pub per_tx: U128, pub per_day: U128 }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    /// Default agent for new wallets (ringfence-agent.near on mainnet).
    agent: AccountId,
    code_hash: Option<[u8; 32]>,
    /// phone_hash -> wallet account
    wallets: LookupMap<String, AccountId>,
    /// short ids already used (an id is a prefix of a phone_hash)
    ids: LookupMap<String, ()>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId) -> Self {
        Self { owner, agent, code_hash: None, wallets: LookupMap::new(b"w"), ids: LookupMap::new(b"i") }
    }

    /// Creates <id>.<factory> running the phone-wallet global contract and initialises it. Attach at least
    /// `min_deposit()`; the excess is refunded. Limits default to the wallet's (0.2 NEAR per transfer, 0.5 per day, 600 s).
    /// The caller must be the owner, so nobody can create (squat) a wallet owned by someone else. phone_hash is an HMAC
    /// under the server's secret, so only the server (after a WhatsApp code) can hand out the right one.
    #[payable]
    pub fn create_wallet(&mut self, phone_hash: String, owner: AccountId, agent: Option<AccountId>, near_limit: Option<Limit>,
                         new_recipient_delay_sec: Option<u64>, recipients: Option<Vec<String>>, custodial: Option<bool>) -> Promise {
        let code_hash = self.code_hash.unwrap_or_else(|| env::panic_str("no wallet code uploaded yet"));
        require!(phone_hash.len() == 64 && phone_hash.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)),
            "phone_hash must be 64 lowercase hex chars");
        require!(env::predecessor_account_id() == owner, "the caller must be the owner");
        require!(!self.wallets.contains_key(&phone_hash), "this phone number already has a wallet");
        let agent = agent.unwrap_or_else(|| self.agent.clone());
        require!(agent != owner, "the agent can't be the owner");
        let deposit = env::attached_deposit();
        require!(deposit >= Self::min_deposit(), format!("attach at least {} yoctoNEAR", Self::min_deposit().as_yoctonear()));

        let mut n = 12;
        while self.ids.contains_key(&phone_hash[..n]) { n += 4; } // never reaches 64: the full hash is unique
        let id = phone_hash[..n].to_string();
        let account: AccountId = format!("{id}.{}", env::current_account_id()).parse().unwrap();
        self.ids.insert(id.clone(), ());
        self.wallets.insert(phone_hash.clone(), account.clone());

        let args = json!({ "owner": owner, "agent": agent, "phone_hash": phone_hash, "evm_chain_ids": [],
            "near_limit": near_limit, "new_recipient_delay_sec": new_recipient_delay_sec, "recipients": recipients, "custodial": custodial });
        Promise::new(account)
            .create_account()
            .transfer(WALLET_STORAGE)
            .use_global_contract(code_hash)
            .function_call("new", args.to_string().into_bytes(), NearToken::from_yoctonear(0), INIT_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS)
                .on_created(phone_hash, id, env::predecessor_account_id(), U128(deposit.as_yoctonear())))
    }

    /// Success: refund the excess. Failure: forget the wallet and refund everything.
    #[private]
    pub fn on_created(&mut self, phone_hash: String, id: String, payer: AccountId, deposit: U128,
                      #[callback_result] r: Result<(), PromiseError>) -> Option<AccountId> {
        let used = WALLET_STORAGE.saturating_add(FACTORY_STORAGE).as_yoctonear();
        let (refund, out) = match r {
            Ok(()) => (deposit.0 - used, self.wallets.get(&phone_hash).cloned()),
            Err(_) => { self.wallets.remove(&phone_hash); self.ids.remove(&id); (deposit.0, None) }
        };
        if refund > 0 { let _ = Promise::new(payer).transfer(NearToken::from_yoctonear(refund)); }
        out
    }

    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        self.agent = agent;
    }

    // ---- view ----

    pub fn min_deposit() -> NearToken { WALLET_STORAGE.saturating_add(FACTORY_STORAGE) }
    pub fn get_wallet(&self, phone_hash: String) -> Option<AccountId> { self.wallets.get(&phone_hash).cloned() }
    pub fn get_config(&self) -> (AccountId, AccountId, Option<Base58CryptoHash>) {
        (self.owner.clone(), self.agent.clone(), self.code_hash.map(Into::into))
    }
}

/// Owner only. Input is the raw phone-wallet wasm (near-cli-rs: `file-args phone_wallet.wasm`). Publishes it as a
/// global contract by hash (the cost is burned from this account's balance) and makes new wallets use it.
/// Existing wallets keep the code they were created with.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn upload_wallet_code() {
    env::setup_panic_hook();
    let mut f: Factory = env::state_read().unwrap_or_else(|| env::panic_str("not initialised"));
    require!(env::predecessor_account_id() == f.owner, "only the owner");
    let code = env::input().unwrap_or_default();
    require!(code.starts_with(b"\0asm"), "input must be the wasm file");
    f.code_hash = Some(env::sha256_array(&code));
    let _ = Promise::new(env::current_account_id()).deploy_global_contract(code);
    env::state_write(&f);
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const H: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    fn ctx(who: usize, deposit: NearToken) {
        testing_env!(VMContextBuilder::new().current_account_id("ringfence-wallet.near".parse().unwrap())
            .predecessor_account_id(accounts(who)).attached_deposit(deposit).build());
    }
    fn factory() -> Factory {
        ctx(0, NearToken::from_yoctonear(0));
        let mut f = Factory::new(accounts(0), accounts(1));
        f.code_hash = Some([7; 32]);
        f
    }
    fn create(f: &mut Factory, h: &str) { let _ = f.create_wallet(h.into(), accounts(3), None, None, None, None, None); }

    #[test]
    fn derives_short_id_and_refuses_duplicate_number() {
        let mut f = factory();
        ctx(3, NearToken::from_near(1)); create(&mut f, H);
        assert_eq!(f.get_wallet(H.into()).unwrap().as_str(), "abcdef012345.ringfence-wallet.near");
    }
    #[test]
    #[should_panic(expected = "already has a wallet")]
    fn duplicate_refused() { let mut f = factory(); ctx(3, NearToken::from_near(1)); create(&mut f, H); create(&mut f, H); }
    #[test]
    fn id_collision_gets_longer_id() {
        let mut f = factory();
        let other = format!("{}{}", &H[..12], "0".repeat(52));
        ctx(3, NearToken::from_near(1)); create(&mut f, H); create(&mut f, &other);
        assert_eq!(f.get_wallet(other).unwrap().as_str(), "abcdef0123450000.ringfence-wallet.near");
    }
    #[test]
    fn implicit_owner_accepted() {
        let mut f = factory();
        testing_env!(VMContextBuilder::new().current_account_id("ringfence-wallet.near".parse().unwrap())
            .predecessor_account_id("a".repeat(64).parse().unwrap()).attached_deposit(NearToken::from_near(1)).build());
        let _ = f.create_wallet(H.into(), "a".repeat(64).parse().unwrap(), None, None, None, None, None);
        assert!(f.get_wallet(H.into()).is_some());
    }
    #[test]
    #[should_panic(expected = "attach at least")]
    fn deposit_too_small() { let mut f = factory(); ctx(3, NearToken::from_millinear(12)); create(&mut f, H); }
    #[test]
    #[should_panic(expected = "64 lowercase hex")]
    fn bad_phone_hash() { let mut f = factory(); ctx(3, NearToken::from_near(1)); create(&mut f, "+15551234"); }
    #[test]
    #[should_panic(expected = "the agent can't be the owner")]
    fn agent_never_owner() { let mut f = factory(); ctx(3, NearToken::from_near(1)); ctx(1, NearToken::from_near(1)); let _ = f.create_wallet(H.into(), accounts(1), None, None, None, None, None); }
    #[test]
    #[should_panic(expected = "no wallet code uploaded")]
    fn needs_code() { ctx(0, NearToken::from_near(1)); let mut f = Factory::new(accounts(0), accounts(1)); create(&mut f, H); }
    #[test]
    #[should_panic(expected = "only the owner")]
    fn only_owner_sets_agent() { let mut f = factory(); ctx(3, NearToken::from_yoctonear(1)); f.set_agent(accounts(3)); }
    #[test]
    #[should_panic(expected = "the caller must be the owner")]
    fn cant_create_for_someone_else() { let mut f = factory(); ctx(3, NearToken::from_near(1)); let _ = f.create_wallet(H.into(), accounts(4), None, None, None, None, None); }
}
