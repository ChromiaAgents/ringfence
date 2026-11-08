// Test double for the Chain Signatures MPC contract (v1.signer-prod.testnet), sandbox only.
// Records the last request and its predecessor, answers with a fixed signature in the real response shape.
use near_sdk::{env, near, AccountId, PanicOnDefault};
use serde_json::Value;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockSigner { last: Option<(AccountId, String)> }

#[near]
impl MockSigner {
    #[init]
    pub fn new() -> Self { Self { last: None } }

    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        assert_eq!(env::attached_deposit().as_yoctonear(), 1, "sign needs 1 yocto");
        self.last = Some((env::predecessor_account_id(), request.to_string()));
        serde_json::json!({ "scheme": "Secp256k1", "big_r": { "affine_point": format!("02{}", "11".repeat(32)) }, "s": { "scalar": "22".repeat(32) }, "recovery_id": 1 })
    }

    pub fn last(&self) -> Option<(AccountId, String)> { self.last.clone() }
}
