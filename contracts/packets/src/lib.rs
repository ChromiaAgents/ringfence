// Red packets: money locked for a group, opened one share at a time. Anyone can fund one (a wallet, a brand, a DAO
// treasury) with `create`; a phone wallet, which can only make plain transfers, sends NEAR here and the agent records
// it with `create_for`. The agent opens a share for someone with `claim` after it heard them say the packet's words on
// a call: that check happens off chain, in a NEAR AI TEE. Shares are equal or a lucky split. What is left after the
// expiry goes back to whoever funded it. Campaign packets (brands) pay a fee to the owner at creation.
// NEAR only for now. The agent is trusted for create_for and claim; it can never take a share for the same account
// twice, pay out more than a packet holds, or touch a packet after it expired. UNAUDITED PROTOTYPE: small amounts.
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

pub const MAX_COUNT: u32 = 100;
/// No share is smaller than this (0.001 NEAR).
pub const MIN_SHARE: u128 = 1_000_000_000_000_000_000_000;
pub const MAX_EXPIRY_SEC: u64 = 30 * 86_400;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Packet {
    /// Who funded it, and where the rest goes after the expiry.
    pub creator: AccountId,
    pub total: U128,
    pub remaining: U128,
    pub count: u32,
    pub claimed: u32,
    /// true: a lucky split (each share is random, between MIN_SHARE and twice the average of what is left).
    pub lucky: bool,
    pub expires_ns: U64,
    pub claimers: Vec<AccountId>,
    /// sha256 (hex) of the words to say, fixed at creation so anyone can check they were not changed later.
    pub phrase_hash: String,
    pub campaign: bool,
    pub refunded: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RedPackets {
    owner: AccountId,
    agent: AccountId,
    /// Campaign fee: basis points of the funded amount, plus `claim_fee` per share (the cost of a new phone wallet).
    fee_bps: u16,
    claim_fee: u128,
    /// NEAR owed to open packets. create_for may only record money that is here and not already owed.
    held: u128,
    packets: LookupMap<String, Packet>,
}

#[near]
impl RedPackets {
    #[init]
    pub fn new(owner: AccountId, agent: AccountId, fee_bps: Option<u16>, claim_fee: Option<U128>) -> Self {
        let fee_bps = fee_bps.unwrap_or(500);
        require!(fee_bps <= 2000, "fee is at most 20%");
        Self { owner, agent, fee_bps, claim_fee: claim_fee.map(|f| f.0).unwrap_or(13 * MIN_SHARE), held: 0, packets: LookupMap::new(b"p") }
    }

    /// Fund a packet with the attached NEAR. `campaign` packets pay the fee to the owner now; the rest is the packet.
    #[payable]
    pub fn create(&mut self, id: String, count: u32, lucky: bool, expires_in_sec: u64, phrase_hash: String, campaign: Option<bool>) -> Packet {
        let paid = env::attached_deposit().as_yoctonear();
        let campaign = campaign.unwrap_or(false);
        let fee = if campaign { paid / 10_000 * self.fee_bps as u128 + count as u128 * self.claim_fee } else { 0 };
        require!(paid > fee, "the deposit doesn't cover the campaign fee");
        let p = self.open(id, env::predecessor_account_id(), paid - fee, count, lucky, expires_in_sec, phrase_hash, campaign);
        if fee > 0 { let _ = Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(fee)); }
        p
    }

    /// The agent records a packet for money a phone wallet already sent here by plain transfer.
    pub fn create_for(&mut self, id: String, creator: AccountId, amount: U128, count: u32, lucky: bool, expires_in_sec: u64, phrase_hash: String) -> Packet {
        self.only_agent();
        let locked = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear() + self.held;
        require!(env::account_balance().as_yoctonear() >= locked + amount.0, "that money has not arrived here");
        self.open(id, creator, amount.0, count, lucky, expires_in_sec, phrase_hash, false)
    }

    /// Opens one share for `to`. Returns the share. One share per account per packet.
    pub fn claim(&mut self, id: String, to: AccountId) -> U128 {
        self.only_agent();
        let mut p = self.packet(&id);
        require!(!p.refunded && env::block_timestamp() < p.expires_ns.0, "this packet has expired");
        require!(p.claimed < p.count, "every share has been opened");
        require!(!p.claimers.contains(&to), "this account already opened its share");
        require!(to != env::current_account_id(), "not to the packet contract");
        let left = (p.count - p.claimed) as u128;
        let share = if left == 1 { p.remaining.0 } else if !p.lucky { p.remaining.0 / left } else {
            // Between MIN_SHARE and twice the average of what is left, never so much that a later share falls under MIN_SHARE.
            let max = (p.remaining.0 / left * 2).min(p.remaining.0 - MIN_SHARE * (left - 1));
            MIN_SHARE + random(&id, p.claimed) % (max - MIN_SHARE + 1)
        };
        p.remaining.0 -= share;
        p.claimed += 1;
        p.claimers.push(to.clone());
        self.held -= share;
        self.packets.insert(id.clone(), p);
        let args = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({ "id": id, "to": to, "share": U128(share) })).unwrap();
        let _ = Promise::new(to).transfer(NearToken::from_yoctonear(share))
            .then(Promise::new(env::current_account_id()).function_call("on_paid".to_string(), args, NearToken::from_yoctonear(0), Gas::from_tgas(8)));
        U128(share)
    }

    /// After a share is sent. If it bounced (the account doesn't exist), the share goes back into the packet,
    /// or to the creator if the packet was refunded meanwhile.
    #[private]
    pub fn on_paid(&mut self, id: String, to: AccountId, share: U128) -> bool {
        if near_sdk::is_promise_success() { return true; }
        let mut p = self.packet(&id);
        if p.refunded {
            let _ = Promise::new(p.creator.clone()).transfer(NearToken::from_yoctonear(share.0));
        } else {
            p.remaining.0 += share.0;
            p.claimed -= 1;
            p.claimers.retain(|c| *c != to);
            self.held += share.0;
            self.packets.insert(id, p);
        }
        false
    }

    /// After the expiry, anyone can send what is left back to whoever funded the packet.
    pub fn refund(&mut self, id: String) -> U128 {
        let mut p = self.packet(&id);
        require!(env::block_timestamp() >= p.expires_ns.0, "not expired yet");
        require!(!p.refunded, "already refunded");
        let rest = p.remaining.0;
        p.remaining.0 = 0;
        p.refunded = true;
        self.held -= rest;
        let creator = p.creator.clone();
        self.packets.insert(id, p);
        if rest > 0 { let _ = Promise::new(creator).transfer(NearToken::from_yoctonear(rest)); }
        U128(rest)
    }

    #[payable]
    pub fn set_agent(&mut self, agent: AccountId) { self.only_owner(); self.agent = agent; }
    #[payable]
    pub fn set_fees(&mut self, fee_bps: u16, claim_fee: U128) {
        self.only_owner();
        require!(fee_bps <= 2000, "fee is at most 20%");
        self.fee_bps = fee_bps;
        self.claim_fee = claim_fee.0;
    }

    pub fn get_packet(&self, id: String) -> Option<Packet> { self.packets.get(&id).cloned() }
    /// (owner, agent, fee_bps, claim_fee, held)
    pub fn get_config(&self) -> (AccountId, AccountId, u16, U128, U128) {
        (self.owner.clone(), self.agent.clone(), self.fee_bps, U128(self.claim_fee), U128(self.held))
    }

    fn only_agent(&self) { require!(env::predecessor_account_id() == self.agent, "only the agent"); }
    fn only_owner(&self) {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }
    fn packet(&self, id: &str) -> Packet { self.packets.get(id).cloned().unwrap_or_else(|| env::panic_str("no such packet")) }
    #[allow(clippy::too_many_arguments)]
    fn open(&mut self, id: String, creator: AccountId, amount: u128, count: u32, lucky: bool, expires_in_sec: u64, phrase_hash: String, campaign: bool) -> Packet {
        require!((1..=64).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-'), "id: 1 to 64 of a-z, 0-9, -");
        require!(!self.packets.contains_key(&id), "this packet id is taken");
        require!((1..=MAX_COUNT).contains(&count), "1 to 100 shares");
        require!(amount >= count as u128 * MIN_SHARE, "at least 0.001 NEAR per share");
        require!((1..=MAX_EXPIRY_SEC).contains(&expires_in_sec), "expiry: up to 30 days");
        require!(phrase_hash.len() <= 64, "phrase_hash: a sha256 in hex");
        let p = Packet { creator, total: U128(amount), remaining: U128(amount), count, claimed: 0, lucky,
            expires_ns: U64(env::block_timestamp() + expires_in_sec * 1_000_000_000), claimers: vec![], phrase_hash, campaign, refunded: false };
        self.held += amount;
        self.packets.insert(id, p.clone());
        p
    }
}

/// The block's random seed mixed with the packet and the share number. A block producer can bias it slightly
/// (it can skip its block); fine for a gift, and said in the README.
fn random(id: &str, n: u32) -> u128 {
    let mut b = env::random_seed();
    b.extend_from_slice(id.as_bytes());
    b.extend_from_slice(&n.to_le_bytes());
    u128::from_le_bytes(env::sha256(&b)[..16].try_into().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const NEAR: u128 = 10u128.pow(24);
    // owner = alice (0), agent = bob (1)
    fn ctx(who: usize, t_sec: u64, deposit: u128, seed: u8) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(who)).block_timestamp(t_sec * 1_000_000_000)
            .attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100)).random_seed([seed; 32]).build());
    }
    fn fresh() -> RedPackets { ctx(0, 1000, 0, 1); RedPackets::new(accounts(0), accounts(1), None, None) }
    fn who(i: u32) -> AccountId { format!("kid{i}.near").parse().unwrap() }

    #[test]
    fn lucky_split_pays_out_exactly_the_total() {
        for seed in 0..40u8 {
            let mut c = fresh();
            let id = format!("cny{seed}"); // a fresh id each round: the previous round's map is flushed into the mock storage on drop
            ctx(2, 1000, NEAR, seed); c.create(id.clone(), 5, true, 3600, "h".into(), None);
            let mut sum = 0;
            let mut shares = vec![];
            for i in 0..5 { ctx(1, 1001, 0, seed.wrapping_add(i as u8)); let s = c.claim(id.clone(), who(i)).0; assert!(s >= MIN_SHARE); sum += s; shares.push(s); }
            assert_eq!(sum, NEAR, "seed {seed}");
            let p = c.get_packet(id).unwrap();
            assert_eq!((p.remaining.0, p.claimed), (0, 5));
            if seed == 7 { assert!(shares.iter().any(|s| *s != shares[0]), "a lucky split is not equal"); }
        }
    }
    #[test]
    fn equal_split() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("eq".into(), 3, false, 3600, "h".into(), None);
        ctx(1, 1001, 0, 1);
        let a = c.claim("eq".into(), who(0)).0; let b = c.claim("eq".into(), who(1)).0; let d = c.claim("eq".into(), who(2)).0;
        assert_eq!(a, NEAR / 3); assert_eq!(b, (NEAR - a) / 2); assert_eq!(a + b + d, NEAR);
    }
    #[test]
    #[should_panic(expected = "already opened its share")]
    fn one_share_per_account() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 3, true, 3600, "h".into(), None);
        ctx(1, 1001, 0, 1); c.claim("p".into(), who(0)); c.claim("p".into(), who(0));
    }
    #[test]
    #[should_panic(expected = "every share has been opened")]
    fn no_more_than_count() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 1, true, 3600, "h".into(), None);
        ctx(1, 1001, 0, 1); c.claim("p".into(), who(0)); c.claim("p".into(), who(1));
    }
    #[test]
    #[should_panic(expected = "only the agent")]
    fn only_agent_opens() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, true, 3600, "h".into(), None);
        ctx(2, 1001, 0, 1); c.claim("p".into(), who(0));
    }
    #[test]
    #[should_panic(expected = "this packet has expired")]
    fn expired_cannot_be_opened() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, true, 60, "h".into(), None);
        ctx(1, 1060, 0, 1); c.claim("p".into(), who(0));
    }
    #[test]
    #[should_panic(expected = "not expired yet")]
    fn no_early_refund() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, true, 60, "h".into(), None);
        ctx(2, 1059, 0, 1); c.refund("p".into());
    }
    #[test]
    fn refund_returns_what_is_left_once() {
        let mut c = fresh();
        ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, false, 60, "h".into(), None);
        ctx(1, 1001, 0, 1); let s = c.claim("p".into(), who(0)).0;
        ctx(5, 1060, 0, 1); assert_eq!(c.refund("p".into()).0, NEAR - s);
        let p = c.get_packet("p".into()).unwrap();
        assert!(p.refunded && p.remaining.0 == 0 && c.get_config().4 .0 == 0);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { ctx(5, 1061, 0, 1); c.refund("p".into()); })).is_err(), "no second refund");
    }
    #[test]
    fn campaign_pays_the_fee_and_the_wallet_cost() {
        let mut c = fresh();
        ctx(3, 1000, 10 * NEAR, 1);
        let p = c.create("brand".into(), 10, true, 3600, "h".into(), Some(true));
        // 5% of 10 NEAR + 10 x 0.013 NEAR
        assert_eq!(p.total.0, 10 * NEAR - NEAR / 2 - 130 * MIN_SHARE);
        assert!(p.campaign);
        ctx(2, 1000, NEAR, 1);
        assert_eq!(c.create("family".into(), 2, true, 3600, "h".into(), None).total.0, NEAR, "family packets pay no fee");
    }
    #[test]
    #[should_panic(expected = "that money has not arrived here")]
    fn create_for_needs_the_money() {
        let mut c = fresh();
        ctx(1, 1000, 0, 1); c.create_for("p".into(), accounts(2), U128(101 * NEAR), 2, true, 3600, "h".into());
    }
    #[test]
    fn create_for_records_a_phone_wallet_packet() {
        let mut c = fresh();
        ctx(1, 1000, 0, 1);
        let p = c.create_for("p".into(), accounts(2), U128(NEAR), 2, true, 3600, "h".into());
        assert_eq!((p.creator, p.total.0, c.get_config().4 .0), (accounts(2), NEAR, NEAR));
    }
    #[test]
    fn bad_packets_refused() {
        let bad = |f: &dyn Fn(&mut RedPackets)| { let mut c = fresh(); std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut c))).is_err() };
        assert!(bad(&|c| { ctx(2, 1000, NEAR, 1); c.create("p".into(), 0, true, 60, "h".into(), None); }), "0 shares");
        assert!(bad(&|c| { ctx(2, 1000, NEAR, 1); c.create("p".into(), 101, true, 60, "h".into(), None); }), "101 shares");
        assert!(bad(&|c| { ctx(2, 1000, MIN_SHARE, 1); c.create("p".into(), 2, true, 60, "h".into(), None); }), "under 0.001 per share");
        assert!(bad(&|c| { ctx(2, 1000, NEAR, 1); c.create("Bad Id".into(), 2, true, 60, "h".into(), None); }), "bad id");
        assert!(bad(&|c| { ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, true, 60, "h".into(), None); c.create("p".into(), 2, true, 60, "h".into(), None); }), "taken id");
        assert!(bad(&|c| { ctx(2, 1000, NEAR, 1); c.create("p".into(), 2, true, 31 * 86_400, "h".into(), None); }), "expiry too long");
        assert!(bad(&|c| { ctx(2, 1000, MIN_SHARE, 1); c.create("p".into(), 1, true, 60, "h".into(), Some(true)); }), "deposit under the campaign fee");
    }
}
