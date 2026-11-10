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

/// A phone-only (custodial) wallet's first payment to a new account: the contract holds it, the custody key (the
/// owner) can stop it or save the recipient, the agent runs it once the wait is over. What src/held.ts relies on.
#[tokio::test]
async fn first_payment_to_a_new_recipient_is_held() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project("./").await?;
    let custody = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let friend = worker.dev_create_account().await?;
    let other = worker.dev_create_account().await?;
    let w = custody.create_subaccount("phone").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let w = w.deploy(&wasm).await?.into_result()?;
    w.call("new").args_json(json!({ "owner": custody.id(), "agent": agent.id(), "phone_hash": "abc", "custodial": true, "new_recipient_delay_sec": 3 })).transact().await?.into_result()?;
    let one = NearToken::from_yoctonear(1);
    let tenth = (NearToken::from_near(1).as_yoctonear() / 10).to_string();
    let send = |to: &near_workspaces::AccountId| agent.call(w.id(), "transfer_near").args_json(json!({ "to": to, "amount": tenth })).max_gas().transact();
    let bal = |a: near_workspaces::Account| async move { a.view_account().await.unwrap().balance.as_yoctonear() };

    // 1. New recipient: queued, not paid. Too early to run.
    let f0 = bal(friend.clone()).await;
    let id: Option<u64> = send(friend.id()).await?.into_result()?.json()?;
    assert_eq!(id, Some(0));
    assert_eq!(bal(friend.clone()).await, f0);
    let early = agent.call(w.id(), "execute").args_json(json!({ "pending_id": 0 })).max_gas().transact().await?;
    assert!(format!("{:?}", early.into_result().unwrap_err()).contains("still in the waiting period"));

    // 2. A second one is stopped by the owner's key before it goes; the agent can't stop or save anything itself.
    let id2: Option<u64> = send(other.id()).await?.into_result()?.json()?;
    assert!(agent.call(w.id(), "cancel").args_json(json!({ "pending_id": id2 })).deposit(one).transact().await?.into_result().is_err());
    custody.call(w.id(), "cancel").args_json(json!({ "pending_id": id2 })).deposit(one).transact().await?.into_result()?;

    // 3. After the wait the agent runs the first one: paid, and counted against today's limit only now.
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    agent.call(w.id(), "execute").args_json(json!({ "pending_id": 0 })).max_gas().transact().await?.into_result()?;
    assert_eq!(bal(friend.clone()).await - f0, NearToken::from_near(1).as_yoctonear() / 10);
    assert!(agent.call(w.id(), "execute").args_json(json!({ "pending_id": id2 })).max_gas().transact().await?.into_result().is_err(), "the cancelled one never goes");

    // 4. The owner's key saves the recipient (allowed on a custodial wallet): the next payment is instant.
    custody.call(w.id(), "allow").args_json(json!({ "recipient": friend.id() })).deposit(one).transact().await?.into_result()?;
    let again: Option<u64> = send(friend.id()).await?.into_result()?.json()?;
    assert_eq!(again, None, "sent at once");
    assert_eq!(bal(friend.clone()).await - f0, NearToken::from_near(1).as_yoctonear() / 5);
    Ok(())
}
