// Local sandbox only (near-workspaces starts its own near-sandbox; nothing touches testnet).
//   cd contracts/phone-wallet && cargo test --test sandbox
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn phone_wallet_in_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project("./").await?;
    let mock = near_workspaces::compile_project("../mock-signer").await?;

    let signer = worker.dev_deploy(&mock).await?;
    signer.call("new").transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let carol = worker.dev_create_account().await?;
    let w = owner.create_subaccount("phone").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let w = w.deploy(&wasm).await?.into_result()?;
    w.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id(), "phone_hash": "abc", "signer": signer.id() })).transact().await?.into_result()?;
    let one = NearToken::from_yoctonear(1);
    let owner_call = |m: &str, a: serde_json::Value| owner.call(w.id(), m).args_json(a).deposit(one).transact();
    owner_call("allow", json!({ "recipient": bob.id() })).await?.into_result()?;
    owner_call("allow", json!({ "recipient": format!("0x{}", "11".repeat(20)) })).await?.into_result()?;
    owner_call("set_delay", json!({ "new_recipient_delay_sec": 2 })).await?.into_result()?;

    // allowlisted: instant
    let before = bob.view_account().await?.balance;
    agent.call(w.id(), "transfer_near").args_json(json!({ "to": bob.id(), "amount": NearToken::from_near(2) })).transact().await?.into_result()?;
    assert_eq!(bob.view_account().await?.balance.as_near(), before.as_near() + 2);

    // over the per-transfer limit (5 NEAR by default)
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

    // Chain Signatures routing: the wallet contract is the predecessor at the signer, path ethereum-1, 1 yocto.
    let tx = "02f183aa36a707843b9aca00847735940082520894111111111111111111111111111111111111111187038d7ea4c6800080c0";
    let sig: serde_json::Value = agent.call(w.id(), "request_signature").args_json(json!({ "chain": "eth:sepolia", "tx": tx })).max_gas().transact().await?.json()?;
    assert_eq!(sig["recovery_id"], 1);
    let (pred, req): (String, String) = signer.view("last").await?.json::<Option<(String, String)>>()?.unwrap();
    assert_eq!(pred, w.id().to_string());
    let req: serde_json::Value = serde_json::from_str(&req)?;
    assert_eq!(req["path"], "ethereum-1");
    assert_eq!(req["domain_id"], 0);
    assert_eq!(req["payload_v2"]["Ecdsa"].as_str().unwrap().len(), 64);
    let st: serde_json::Value = w.view("get_state").await?.json()?;
    assert_eq!(st["spent_today"]["eth:sepolia"], "1000000000000000");

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
