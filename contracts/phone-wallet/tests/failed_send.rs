// A send that fails on the other side must not be counted as spent, and the failure must be visible in the receipts
// (the server reads them: src/wallet.ts callContract). Local sandbox only.
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn failed_sends_are_not_counted() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project("./").await?;
    let ft = worker.dev_deploy(&near_workspaces::compile_project("../mock-ft").await?).await?;
    ft.call("new").transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let grocer = worker.dev_create_account().await?;
    let w = owner.create_subaccount("phone").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let w = w.deploy(&wasm).await?.into_result()?;
    w.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id(), "phone_hash": "abc", "usdc": ft.id() })).transact().await?.into_result()?;
    let one = NearToken::from_yoctonear(1);
    owner.call(w.id(), "allow").args_json(json!({ "recipient": grocer.id() })).deposit(one).transact().await?.into_result()?;
    owner.call(w.id(), "allow").args_json(json!({ "recipient": "nobody-here.test.near" })).deposit(one).transact().await?.into_result()?;
    let usdc = format!("ft:{}", ft.id());
    let spent = |k: String| { let w = w.clone(); async move { w.view("get_state").await.unwrap().json::<serde_json::Value>().unwrap()["spent_today"][k].as_str().unwrap_or("0").to_string() } };
    let send_ft = |amt: &str| agent.call(w.id(), "transfer_ft").args_json(json!({ "token": ft.id(), "to": grocer.id(), "amount": amt })).max_gas().transact();

    // 1. The wallet holds no USDC: ft_transfer fails. Visible as a receipt failure, and not counted.
    let r = send_ft("5000000").await?;
    assert!(!r.receipt_failures().is_empty(), "the failed ft_transfer shows in the receipts");
    assert_eq!(spent(usdc.clone()).await, "0", "a failed USDC send is not counted as spent");

    // 2. Funded: the same send works and is counted.
    ft.call("mint").args_json(json!({ "account_id": w.id(), "amount": "20000000" })).transact().await?.into_result()?;
    let r = send_ft("5000000").await?;
    assert!(r.receipt_failures().is_empty());
    assert_eq!(spent(usdc.clone()).await, "5000000");
    assert_eq!(ft.view("ft_balance_of").args_json(json!({ "account_id": grocer.id() })).await?.json::<String>()?, "5000000");

    // 3. NEAR to a saved account that does not exist: refunded by the protocol, not counted.
    let r = agent.call(w.id(), "transfer_near").args_json(json!({ "to": "nobody-here.test.near", "amount": NearToken::from_near(1).as_yoctonear().to_string() })).max_gas().transact().await?;
    assert!(!r.receipt_failures().is_empty());
    assert_eq!(spent("near".into()).await, "0");

    // 4. on_sent is private: nobody else can lower the spent counter.
    let r = agent.call(w.id(), "on_sent").args_json(json!({ "asset": usdc, "amount": "5000000" })).transact().await?;
    assert!(r.into_result().is_err());
    Ok(())
}
