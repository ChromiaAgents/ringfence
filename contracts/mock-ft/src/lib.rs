// Test-only NEP-141 token for the sandbox: storage_deposit (registration, refunds when already registered),
// ft_transfer (1 yocto, registered receiver required, like real tokens), ft_balance_of, and mint.
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Ft { balances: LookupMap<AccountId, u128> }

#[near]
impl Ft {
    #[init]
    pub fn new() -> Self { Self { balances: LookupMap::new(b"b") } }
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let b = self.balances.get(&account_id).copied().unwrap_or(0);
        self.balances.insert(account_id, b + amount.0);
    }
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) {
        let _ = registration_only;
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        let paid = env::attached_deposit();
        if self.balances.contains_key(&who) { if !paid.is_zero() { let _ = Promise::new(env::predecessor_account_id()).transfer(paid); } return; }
        require!(paid >= NearToken::from_yoctonear(1_250_000_000_000_000_000_000), "storage deposit too small");
        self.balances.insert(who, 0);
    }
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let _ = memo;
        near_sdk::assert_one_yocto();
        let from = env::predecessor_account_id();
        let fb = self.balances.get(&from).copied().unwrap_or_else(|| env::panic_str("sender not registered"));
        require!(fb >= amount.0, "not enough balance");
        let tb = self.balances.get(&receiver_id).copied().unwrap_or_else(|| env::panic_str("receiver not registered"));
        self.balances.insert(from, fb - amount.0);
        self.balances.insert(receiver_id, tb + amount.0);
    }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 { U128(self.balances.get(&account_id).copied().unwrap_or(0)) }
}
