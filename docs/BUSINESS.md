# Business model and roadmap

This page is a plan. Nothing on it is needed to check the project, and the parts marked "not built" do not exist in the code. What is built and how to check it is in the [README](../README.md).

## Who would pay

- **Brands and communities.** The packets contract has a fee for campaign packets: with `campaign: true`, `create` sends 5% plus 0.013 NEAR per share to the contract owner when the packet is funded. This is a tested contract method (`cargo test` in `contracts/packets`). There is no page for it, no brand packet on mainnet and no customer.
- **Family packets are free.** A packet funded by voice pays no fee to Ringfence.
- **Cost per new wallet:** 0.013 NEAR, paid to the factory for storage when a wallet is created.

## How a packet could bring in new users

- On WhatsApp a share is paid into the opener's phone wallet. An opener with no wallet is told to text "create a wallet" first. Opening a share does not create a wallet by itself.
- On a browser call the share goes to a NEAR account the opener names, so no wallet is created.
- WhatsApp runs on Meta's test number today, so this path cannot be tried by the public yet.

The comparison we have in mind is WeChat red packets around the 2015 Spring Festival. TechNode's report from that time is [here](https://technode.com/2015/02/27/wechat-payment-clear-winner-in-tencent-alibaba-digital-lucky-money-war/). We have not checked its figures ourselves.

## Next, not built: packets that earn staking yield

Designed only. No packet is staked today and no staking code is in the contracts.

- When a packet is funded, the packets contract would deposit the NEAR into a liquid-staking pool and keep the receipt token.
- When someone opens a share, they would get the gift plus the yield earned so far. Ringfence would keep a share of the yield as its fee.
- It would go in the packets contract, which can be redeployed by its operator key. That was done once on mainnet, v1 to v2, with the data kept. The phone wallets would not change.
- The amounts are small. At a yield of a few percent a year, 1 NEAR staked for a week earns a few thousandths of a NEAR at most. It would matter for large campaigns and long-lived packets, not for a family gift opened the same day.

## Other ideas, not built

- A fee when people cash out or swap.
- Packets in USDC.
- A TEE-held agent key, so the operator cannot spend inside a wallet's limits.
