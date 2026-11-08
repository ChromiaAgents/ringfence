// Local sandbox only (near-workspaces starts its own near-sandbox; nothing touches testnet or mainnet).
//   cd contracts/factory && cargo test --test sandbox -- --nocapture   (prints the measured costs)
use near_workspaces::types::NearToken;
use serde_json::json;

fn err(r: near_workspaces::result::ExecutionFinalResult) -> String { format!("{:?}", r.into_result().unwrap_err()) }
const Y: u128 = 1_000_000_000_000_000_000_000_000;
fn near(y: u128) -> f64 { y as f64 / Y as f64 }

#[tokio::test]
async fn factory_in_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let factory_wasm = near_workspaces::compile_project("./").await?;
    let wallet_wasm = near_workspaces::compile_project("../phone-wallet").await?;
    let root = worker.root_account()?;
    // like mainnet: the factory is a top-level-ish named account and wallets are its sub-accounts
    let factory = root.create_subaccount("ringfence-wallet").initial_balance(NearToken::from_near(50)).transact().await?.into_result()?;
    let custody = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let family = worker.dev_create_account().await?;
    let payer = worker.dev_create_account().await?;
    let liho = worker.dev_create_account().await?;
    factory.deploy(&factory_wasm).await?.into_result()?;
    factory.call(factory.id(), "new").args_json(json!({ "owner": custody.id(), "agent": agent.id() })).transact().await?.into_result()?;
    let h1 = "1".repeat(64);
    let h2 = "2".repeat(64);
    let create = |h: &str, owner: &str, dep: NearToken| payer.call(factory.id(), "create_wallet")
        .args_json(json!({ "phone_hash": h, "owner": owner })).deposit(dep).max_gas().transact();

    // no code yet: refused
    assert!(err(create(&h1, custody.id().as_str(), NearToken::from_near(1)).await?).contains("no wallet code uploaded"));
    // only the owner uploads
    let r = payer.call(factory.id(), "upload_wallet_code").args(wallet_wasm.clone()).max_gas().transact().await?;
    assert!(err(r).contains("only the owner"));

    // (a) one-time global upload: burned from the factory's balance
    let f0 = factory.view_account().await?.balance.as_yoctonear();
    custody.call(factory.id(), "upload_wallet_code").args(wallet_wasm.clone()).max_gas().transact().await?.into_result()?;
    let f1 = factory.view_account().await?.balance.as_yoctonear();
    let cfg: serde_json::Value = worker.view(factory.id(), "get_config").await?.json()?;
    assert!(cfg[2].is_string());

    // (b) per wallet: named custodial owner; excess refunded
    let p0 = payer.view_account().await?.balance.as_yoctonear();
    let r = create(&h1, custody.id().as_str(), NearToken::from_near(1)).await?;
    let burnt: u128 = r.outcomes().iter().map(|o| o.tokens_burnt.as_yoctonear()).sum();
    let w1: String = r.into_result()?.json::<Option<String>>()?.expect("created");
    let p1 = payer.view_account().await?.balance.as_yoctonear();
    assert_eq!(w1, format!("111111111111.{}", factory.id()));
    let wallet_cost = p0 - p1 - burnt;
    // min_deposit (0.013) kept; the rest refunded. The small extra is gas not counted in tokens_burnt (refund penalty).
    assert!(wallet_cost >= 13 * Y / 1000 && wallet_cost < 14 * Y / 1000, "{wallet_cost}");
    let wv = worker.view_account(&w1.parse()?).await?;
    let st: serde_json::Value = worker.view(&w1.parse()?, "get_state").await?.json()?;
    assert_eq!(st["owner"], custody.id().to_string());
    assert_eq!(st["agent"], agent.id().to_string());
    assert_eq!(st["limits"]["near"]["per_tx"], (Y / 5).to_string());
    assert_eq!(st["limits"]["near"]["per_day"], (Y / 2).to_string());
    assert_eq!(st["chains"], json!([]));
    assert!(format!("{:?}", wv.contract_state).starts_with("GlobalHash"), "no own code: it uses the global one");

    // duplicate number refused (the deposit comes back with the failed tx)
    assert!(err(create(&h1, family.id().as_str(), NearToken::from_near(1)).await?).contains("already has a wallet"));

    // implicit (64-hex) owner, custom limits and a saved recipient
    let implicit = "ab".repeat(32);
    let r = payer.call(factory.id(), "create_wallet").args_json(json!({ "phone_hash": h2, "owner": implicit,
        "near_limit": { "per_tx": (Y / 10).to_string(), "per_day": (Y / 4).to_string() }, "new_recipient_delay_sec": 2,
        "recipients": [liho.id()] })).deposit(NearToken::from_millinear(13)).max_gas().transact().await?;
    let w2: String = r.into_result()?.json::<Option<String>>()?.unwrap();
    let st: serde_json::Value = worker.view(&w2.parse()?, "get_state").await?.json()?;
    assert_eq!(st["owner"], implicit);
    assert_eq!(st["new_recipient_delay_sec"], 2);
    assert_eq!(st["allowlist"], json!([liho.id().to_string()]));
    let fw: Option<String> = worker.view(factory.id(), "get_wallet").args_json(json!({ "phone_hash": h2 })).await?.json()?;
    assert_eq!(fw, Some(w2.clone()));

    // the wallet works: fund it, the agent sends to the saved... (w1 has no saved recipients: allow liho first)
    let w1id: near_workspaces::AccountId = w1.parse()?;
    payer.transfer_near(&w1id, NearToken::from_near(2)).await?.into_result()?;
    let one = NearToken::from_yoctonear(1);
    custody.call(&w1id, "allow").args_json(json!({ "recipient": liho.id() })).deposit(one).transact().await?.into_result()?;
    let send = |amt: u128| agent.call(&w1id, "transfer_near").args_json(json!({ "to": liho.id(), "amount": amt.to_string() })).transact();
    send(Y / 10).await?.into_result()?;
    assert!(err(send(Y / 4).await?).contains("over the per-transfer limit"));

    // freeze (Reject button): agent blocked, owner withdraw still works
    custody.call(&w1id, "freeze").args_json(json!({ "until_ts": "99999999999" })).deposit(one).transact().await?.into_result()?;
    assert!(err(send(Y / 10).await?).contains("frozen by the owner"));
    custody.call(&w1id, "withdraw").args_json(json!({ "amount": (Y / 2).to_string() })).deposit(one).transact().await?.into_result()?;
    custody.call(&w1id, "unfreeze").deposit(one).transact().await?.into_result()?;
    send(Y / 10).await?.into_result()?;

    // claim: custody proposes the family, the agent can't accept, cancel works, then the family accepts
    custody.call(&w1id, "propose_owner").args_json(json!({ "new_owner": family.id() })).deposit(one).transact().await?.into_result()?;
    assert!(err(agent.call(&w1id, "accept_owner").transact().await?).contains("not the proposed owner"));
    custody.call(&w1id, "cancel_owner_transfer").deposit(one).transact().await?.into_result()?;
    assert!(err(family.call(&w1id, "accept_owner").transact().await?).contains("not the proposed owner"));
    custody.call(&w1id, "propose_owner").args_json(json!({ "new_owner": family.id() })).deposit(one).transact().await?.into_result()?;
    family.call(&w1id, "accept_owner").transact().await?.into_result()?;
    assert!(err(custody.call(&w1id, "withdraw").args_json(json!({ "amount": "1" })).deposit(one).transact().await?).contains("only the owner"));
    family.call(&w1id, "withdraw").args_json(json!({ "amount": "1" })).deposit(one).transact().await?.into_result()?;
    assert!(err(custody.call(&w1id, "propose_owner").args_json(json!({ "new_owner": agent.id() })).deposit(one).transact().await?).contains("only the owner"));

    // costs, for HANDOVER.md
    let wasm_len = wallet_wasm.len() as u128;
    println!("COST wasm bytes: {wasm_len}");
    println!("COST global upload (factory balance drop): {:.5} NEAR", near(f0 - f1));
    println!("COST per wallet (charged to payer, excl. gas): {:.5} NEAR; wallet storage_usage {} bytes, balance {:.5}",
        near(wallet_cost), wv.storage_usage, near(wv.balance.as_yoctonear()));
    println!("COST per wallet if each deployed its own code (wasm bytes x 1e19): {:.5} NEAR", near(wasm_len * 10_000_000_000_000_000_000));
    Ok(())
}
