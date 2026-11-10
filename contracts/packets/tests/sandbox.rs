// Local sandbox only (near-workspaces starts its own near-sandbox; nothing touches testnet or mainnet).
//   cd contracts/packets && cargo test --test sandbox -- --nocapture
use near_workspaces::types::NearToken;
use serde_json::json;

const Y: u128 = 1_000_000_000_000_000_000_000_000;
fn err(r: near_workspaces::result::ExecutionFinalResult) -> String { format!("{:?}", r.into_result().unwrap_err()) }

#[tokio::test]
async fn red_packets_in_sandbox() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = match std::env::var("PACKETS_WASM").ok().map(std::fs::read).transpose()? { Some(w) => w, None => near_workspaces::compile_project("./").await? };
    println!("COST packets wasm bytes: {}", wasm.len());
    // Like mainnet: the contract account holds little more than its own storage, so create_for can only record money that arrived.
    let c = worker.root_account()?.create_subaccount("packets").initial_balance(NearToken::from_near(3)).transact().await?.into_result()?;
    let c = c.deploy(&wasm).await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let brand = worker.dev_create_account().await?;
    let mum = worker.dev_create_account().await?; // stands in for a phone wallet: it can only make plain transfers
    let kids = [worker.dev_create_account().await?, worker.dev_create_account().await?, worker.dev_create_account().await?];
    c.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id() })).transact().await?.into_result()?;
    let bal = |a: near_workspaces::Account| async move { a.view_account().await.unwrap().balance.as_yoctonear() };
    let packet = |id: &str| { let c = c.clone(); let id = id.to_string(); async move { c.view("get_packet").args_json(json!({ "id": id })).await.unwrap().json::<serde_json::Value>().unwrap() } };
    let claim = |id: &str, to: &near_workspaces::AccountId| agent.call(c.id(), "claim").args_json(json!({ "id": id, "to": to })).max_gas().transact();

    // 1. A brand funds a campaign packet: 5% + 3 x 0.013 NEAR goes to the owner right away.
    let o0 = bal(owner.clone()).await;
    brand.call(c.id(), "create").args_json(json!({ "id": "brand-1", "count": 3, "lucky": true, "expires_in_sec": 3600, "phrase_hash": "ab", "campaign": true }))
        .deposit(NearToken::from_near(10)).transact().await?.into_result()?;
    let fee = bal(owner.clone()).await - o0;
    assert_eq!(fee, Y / 2 + 39 * Y / 1000, "campaign fee reached the owner");
    let total = 10 * Y - fee;
    assert_eq!(packet("brand-1").await["total"], total.to_string());

    // 2. Lucky split: three people open it, the shares differ and add up to the packet exactly.
    let mut got = vec![];
    for k in &kids {
        let b0 = bal(k.clone()).await;
        claim("brand-1", k.id()).await?.into_result()?;
        got.push(bal(k.clone()).await - b0);
    }
    println!("LUCKY shares (NEAR): {:?}", got.iter().map(|g| *g as f64 / Y as f64).collect::<Vec<_>>());
    assert_eq!(got.iter().sum::<u128>(), total);
    assert!(got.iter().all(|g| *g >= Y / 1000));
    assert!(err(claim("brand-1", kids[0].id()).await?).contains("every share has been opened"));

    // 3. Mum's phone wallet: a plain transfer in, then the agent records the packet. Not before the money is here.
    assert!(err(agent.call(c.id(), "create_for").args_json(json!({ "id": "mum-1", "creator": mum.id(), "amount": (2 * Y).to_string(), "count": 2, "lucky": false, "expires_in_sec": 4, "phrase_hash": "cd" }))
        .transact().await?).contains("that money has not arrived here"));
    mum.transfer_near(c.id(), NearToken::from_near(2)).await?.into_result()?;
    assert!(err(brand.call(c.id(), "create_for").args_json(json!({ "id": "mum-1", "creator": brand.id(), "amount": (2 * Y).to_string(), "count": 2, "lucky": false, "expires_in_sec": 4, "phrase_hash": "cd" }))
        .transact().await?).contains("only the agent"));
    agent.call(c.id(), "create_for").args_json(json!({ "id": "mum-1", "creator": mum.id(), "amount": (2 * Y).to_string(), "count": 2, "lucky": false, "expires_in_sec": 4, "phrase_hash": "cd" }))
        .transact().await?.into_result()?;
    // the same money can't back a second packet
    assert!(err(agent.call(c.id(), "create_for").args_json(json!({ "id": "mum-2", "creator": mum.id(), "amount": (2 * Y).to_string(), "count": 2, "lucky": false, "expires_in_sec": 4, "phrase_hash": "cd" }))
        .transact().await?).contains("that money has not arrived here"));

    // 4. A share sent to an account that doesn't exist bounces back into the packet.
    let r = claim("mum-1", &"nobody-here.test.near".parse()?).await?;
    assert!(!r.receipt_failures().is_empty());
    let p = packet("mum-1").await;
    assert_eq!((p["claimed"].as_u64(), p["remaining"].as_str()), (Some(0), Some((2 * Y).to_string().as_str())));

    // 5. One kid opens an equal share; one share per account; nobody but the agent opens.
    let b0 = bal(kids[0].clone()).await;
    claim("mum-1", kids[0].id()).await?.into_result()?;
    assert_eq!(bal(kids[0].clone()).await - b0, Y);
    assert!(err(claim("mum-1", kids[0].id()).await?).contains("already opened its share"));
    assert!(err(kids[1].call(c.id(), "claim").args_json(json!({ "id": "mum-1", "to": kids[1].id() })).transact().await?).contains("only the agent"));

    // 6. After the expiry: no more opening, and anyone can send the rest back to Mum. Once.
    assert!(err(brand.call(c.id(), "refund").args_json(json!({ "id": "mum-1" })).transact().await?).contains("not expired yet"));
    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    assert!(err(claim("mum-1", kids[1].id()).await?).contains("this packet has expired"));
    let m0 = bal(mum.clone()).await;
    brand.call(c.id(), "refund").args_json(json!({ "id": "mum-1" })).transact().await?.into_result()?;
    assert_eq!(bal(mum.clone()).await - m0, Y, "the unopened share went back to Mum");
    assert!(err(brand.call(c.id(), "refund").args_json(json!({ "id": "mum-1" })).transact().await?).contains("already refunded"));
    let cfg: serde_json::Value = c.view("get_config").await?.json()?;
    assert_eq!(cfg[4], "0", "nothing is owed once every packet is opened or refunded");
    Ok(())
}
