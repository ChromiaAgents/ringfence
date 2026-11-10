// Local sandbox only (near-workspaces starts its own near-sandbox; nothing touches testnet).
//   cd contracts/phone-wallet && cargo test --test sandbox                  (NEAR-only build, the default)
//   cd contracts/phone-wallet && cargo test --test sandbox --features evm   (with Chain Signatures)
use near_workspaces::types::NearToken;
use serde_json::json;

/// compile_project builds default features only; the EVM build goes through cargo near directly.
#[cfg(feature = "evm")]
async fn wallet_wasm() -> anyhow::Result<Vec<u8>> {
    let st = std::process::Command::new("cargo")
        .args(["near", "build", "non-reproducible-wasm", "--no-abi", "--features", "evm", "--out-dir", "target/near-evm"])
        .env_remove("CARGO_TARGET_DIR").status()?;
    anyhow::ensure!(st.success(), "cargo near build --features evm failed");
    Ok(std::fs::read("target/near-evm/phone_wallet.wasm")?)
}
#[cfg(not(feature = "evm"))]
async fn wallet_wasm() -> anyhow::Result<Vec<u8>> { Ok(near_workspaces::compile_project("./").await?) }

#[tokio::test]
async fn phone_wallet_in_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = wallet_wasm().await?;
    let mock = near_workspaces::compile_project("../mock-signer").await?;

    let signer = worker.dev_deploy(&mock).await?;
    signer.call("new").transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let carol = worker.dev_create_account().await?;
    let w = owner.create_subaccount("phone").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let w = w.deploy(&wasm).await?.into_result()?;
    w.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id(), "phone_hash": "abc", "signer": signer.id(), "evm_chain_ids": [11155111, 8453],
        "near_limit": { "per_tx": NearToken::from_near(5).as_yoctonear().to_string(), "per_day": NearToken::from_near(10).as_yoctonear().to_string() },
        "evm_limit": { "per_tx": "10000000000000000", "per_day": "20000000000000000" } })).transact().await?.into_result()?;
    let one = NearToken::from_yoctonear(1);
    let owner_call = |m: &str, a: serde_json::Value| owner.call(w.id(), m).args_json(a).deposit(one).transact();
    owner_call("allow", json!({ "recipient": bob.id() })).await?.into_result()?;
    owner_call("allow", json!({ "recipient": format!("0x{}", "11".repeat(20)) })).await?.into_result()?;
    owner_call("set_delay", json!({ "new_recipient_delay_sec": 2 })).await?.into_result()?;

    // allowlisted: instant
    let before = bob.view_account().await?.balance;
    agent.call(w.id(), "transfer_near").args_json(json!({ "to": bob.id(), "amount": NearToken::from_near(2) })).transact().await?.into_result()?;
    assert_eq!(bob.view_account().await?.balance.as_near(), before.as_near() + 2);

    // over the per-transfer limit (5 NEAR, set at init)
    let r = agent.call(w.id(), "transfer_near").args_json(json!({ "to": bob.id(), "amount": NearToken::from_near(6) })).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("over the per-transfer limit"));

    // new recipient: queued, too early, then runs after the delay
    let id: Option<u64> = agent.call(w.id(), "transfer_near").args_json(json!({ "to": carol.id(), "amount": NearToken::from_near(1) })).transact().await?.json()?;
    let id = id.expect("queued");
    let early = agent.call(w.id(), "execute").args_json(json!({ "pending_id": id })).transact().await?;
    assert!(format!("{:?}", early.into_result().unwrap_err()).contains("waiting period"));
    worker.fast_forward(100).await?;
    let c0 = carol.view_account().await?.balance;
    agent.call(w.id(), "execute").args_json(json!({ "pending_id": id })).transact().await?.into_result()?;
    assert_eq!(carol.view_account().await?.balance.as_near(), c0.as_near() + 1);

    // NEAR-only build: the EVM path isn't in the wasm at all, and the chains passed at init are ignored.
    #[cfg(not(feature = "evm"))]
    {
        let st: serde_json::Value = w.view("get_state").await?.json()?;
        assert_eq!(st["chains"], json!([]));
        assert!(st["limits"].get("evm:8453").is_none());
        let r = agent.call(w.id(), "request_signature").args_json(json!({ "chain": "evm:11155111", "tx": "02" })).max_gas().transact().await?;
        assert!(format!("{:?}", r.into_result().unwrap_err()).contains("MethodNotFound"));
        let r = owner_call("allow_chain", json!({ "chain_id": 1, "per_tx": "1", "per_day": "1" })).await?;
        assert!(format!("{:?}", r.into_result().unwrap_err()).contains("MethodNotFound"));
    }
    #[cfg(feature = "evm")]
    {
    // Chain Signatures routing: the wallet contract is the predecessor at the signer, path ethereum-1, 1 yocto.
    let tx = "02f183aa36a707843b9aca00847735940082520894111111111111111111111111111111111111111187038d7ea4c6800080c0";
    let sig: serde_json::Value = agent.call(w.id(), "request_signature").args_json(json!({ "chain": "evm:11155111", "tx": tx })).max_gas().transact().await?.json()?;
    assert_eq!(sig["recovery_id"], 1);
    let (pred, req): (String, String) = signer.view("last").await?.json::<Option<(String, String)>>()?.unwrap();
    assert_eq!(pred, w.id().to_string());
    let req: serde_json::Value = serde_json::from_str(&req)?;
    assert_eq!(req["path"], "ethereum-1");
    assert_eq!(req["domain_id"], 0);
    assert_eq!(req["payload_v2"]["Ecdsa"].as_str().unwrap().len(), 64);
    let st: serde_json::Value = w.view("get_state").await?.json()?;
    assert_eq!(st["spent_today"]["evm:11155111"], (1_000_000_000_000_000u128 + 21_000 * 2_000_000_000).to_string()); // value + gas * maxFee

    // Base (8453) through the same path: the same derived address signs on every EVM chain
    let base = "02ef82210507843b9aca008477359400825208941111111111111111111111111111111111111111865af3107a400080c0";
    agent.call(w.id(), "request_signature").args_json(json!({ "chain": "evm:8453", "tx": base })).max_gas().transact().await?.into_result()?;
    let st: serde_json::Value = w.view("get_state").await?.json()?;
    assert_eq!(st["spent_today"]["evm:8453"], (100_000_000_000_000u128 + 21_000 * 2_000_000_000).to_string());
    // a chain the owner never allowed is refused
    let r = agent.call(w.id(), "request_signature").args_json(json!({ "chain": "evm:42161", "tx": base })).max_gas().transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("chain not allowed by the owner"));

    }

    // the agent can't call owner methods
    let r = agent.call(w.id(), "set_limits").args_json(json!({ "asset": "near", "per_tx": "1", "per_day": "1" })).deposit(one).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("only the owner"));

    // owner withdraw works while the agent is set
    let o0 = owner.view_account().await?.balance;
    owner_call("withdraw", json!({ "amount": NearToken::from_near(5) })).await?.into_result()?;
    assert!(owner.view_account().await?.balance.as_near() >= o0.as_near() + 4);

    // revoke: the agent is locked out
    owner_call("revoke_agent", json!({})).await?.into_result()?;
    let r = agent.call(w.id(), "transfer_near").args_json(json!({ "to": bob.id(), "amount": NearToken::from_near(1) })).transact().await?;
    assert!(format!("{:?}", r.into_result().unwrap_err()).contains("only the agent"));
    Ok(())
}

/// USDC path on the real runtime: a NEP-141 token, a recipient that was never registered with it (the wallet pays
/// its storage), limits per token, the new-recipient queue, and the owner's withdraw_ft.
#[cfg(not(feature = "evm"))]
#[tokio::test]
async fn usdc_in_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = wallet_wasm().await?;
    let ft = worker.dev_deploy(&near_workspaces::compile_project("../mock-ft").await?).await?;
    ft.call("new").transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let grocer = worker.dev_create_account().await?;
    let son = worker.dev_create_account().await?;
    let w = owner.create_subaccount("phone").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let w = w.deploy(&wasm).await?.into_result()?;
    w.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id(), "phone_hash": "abc", "usdc": ft.id(),
        "usdc_limit": { "per_tx": "25000000", "per_day": "60000000" } })).transact().await?.into_result()?;
    // The wallet holds 100 USDC; the grocer has never touched the token.
    ft.call("mint").args_json(json!({ "account_id": w.id(), "amount": "100000000" })).transact().await?.into_result()?;
    let bal = |a: near_workspaces::AccountId| { let ft = ft.clone(); async move { ft.view("ft_balance_of").args_json(json!({ "account_id": a })).await.unwrap().json::<String>().unwrap() } };
    let one = NearToken::from_yoctonear(1);
    owner.call(w.id(), "allow").args_json(json!({ "recipient": grocer.id() })).deposit(one).transact().await?.into_result()?;
    let send = |to: &near_workspaces::AccountId, amt: &str| agent.call(w.id(), "transfer_ft").args_json(json!({ "token": ft.id(), "to": to, "amount": amt })).max_gas().transact();

    // 11.50 USDC (about RM 50) to a saved, unregistered recipient: registered and paid in one go.
    send(grocer.id(), "11500000").await?.into_result()?;
    assert_eq!(bal(grocer.id().clone()).await, "11500000");
    assert_eq!(bal(w.id().clone()).await, "88500000");
    // over the per-transfer limit: refused by the contract
    assert!(format!("{:?}", send(grocer.id(), "25000001").await?.into_result().unwrap_err()).contains("over the per-transfer limit"));
    // a new recipient is queued, not paid
    let r = send(son.id(), "1000000").await?.into_result()?.json::<Option<u64>>()?;
    assert_eq!(r, Some(0));
    assert_eq!(bal(son.id().clone()).await, "0");

    // the owner always gets the tokens out
    owner.call(w.id(), "withdraw_ft").args_json(json!({ "token": ft.id(), "amount": "88500000" })).deposit(one).max_gas().transact().await?.into_result()?;
    assert_eq!(bal(owner.id().clone()).await, "88500000");
    Ok(())
}
