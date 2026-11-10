// The mainnet path: the released packets contract (contracts/release/red_packets.wasm) with a packet in it is
// redeployed with this build, without an init call. The old packet must still load, open and refund.
use near_workspaces::types::NearToken;
use serde_json::json;
const Y: u128 = 1_000_000_000_000_000_000_000_000;

#[tokio::test]
async fn upgrade_keeps_old_packets() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let old = std::fs::read("../release/red_packets-v1.wasm")?;
    let new = match std::env::var("PACKETS_WASM").ok().map(std::fs::read).transpose()? { Some(w) => w, None => near_workspaces::compile_project("./").await? };
    let acc = worker.root_account()?.create_subaccount("packets").initial_balance(NearToken::from_near(3)).transact().await?.into_result()?;
    let owner = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let mum = worker.dev_create_account().await?;
    let kid = worker.dev_create_account().await?;
    let c = acc.deploy(&old).await?.into_result()?;
    c.call("new").args_json(json!({ "owner": owner.id(), "agent": agent.id() })).transact().await?.into_result()?;
    mum.transfer_near(c.id(), NearToken::from_near(1)).await?.into_result()?;
    agent.call(c.id(), "create_for").args_json(json!({ "id": "old-1", "creator": mum.id(), "amount": Y.to_string(), "count": 2, "lucky": false, "expires_in_sec": 3600, "phrase_hash": "ab" }))
        .transact().await?.into_result()?;

    let c = acc.deploy(&new).await?.into_result()?; // no init: state is kept
    let cfg = c.view("get_config").await?.json::<serde_json::Value>()?;
    assert_eq!(cfg[4], Y.to_string(), "held survived the upgrade");
    assert_eq!(c.view("is_paused").await?.json::<bool>()?, false);
    let p = c.view("get_packet").args_json(json!({ "id": "old-1" })).await?.json::<serde_json::Value>()?;
    assert_eq!(p["remaining"], Y.to_string());
    let b0 = kid.view_account().await?.balance.as_yoctonear();
    agent.call(c.id(), "claim").args_json(json!({ "id": "old-1", "to": kid.id() })).max_gas().transact().await?.into_result()?;
    assert_eq!(kid.view_account().await?.balance.as_yoctonear() - b0, Y / 2, "old packet opens after the upgrade");
    let m0 = mum.view_account().await?.balance.as_yoctonear();
    owner.call(c.id(), "cancel").args_json(json!({ "id": "old-1" })).deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert_eq!(mum.view_account().await?.balance.as_yoctonear() - m0, Y / 2, "owner can cancel an old packet");
    Ok(())
}
