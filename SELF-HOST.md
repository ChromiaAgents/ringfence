# Self-host Ringfence in about 15 minutes

Mum can make a phone call. She doesn't know how to use MetaMask. The family (the guardian) owns her phone wallet, and the contract caps what the AI agent can spend.

With the hosted Ringfence, our server holds the agent key. If you would rather trust your own server, run your own operator and point your wallet's agent at it. The contract rules stay the same: the agent spends only within your limits, and only the owner can withdraw, change limits or revoke the agent.

## Trust levels

| Level | Who holds the agent key | What they could do at worst | What still protects you |
| --- | --- | --- | --- |
| Hosted (ringfence-agent.near) | Us | Spend up to your daily limit, to your saved recipients | Contract limits, `revoke_agent`, `withdraw` |
| Self-hosted (this guide) | You, on your VPS | Same, but the operator is you | Same, plus no third party in the path |
| TEE-held key (next) | An attested enclave | Only what the attested code does | Same, plus a remote attestation you can check |

The agent can never become the owner (enforced in `contracts/phone-wallet/src/lib.rs`). The contract is unaudited: keep small amounts in it.

## Requirements

- A Linux VPS (Ubuntu 24.04, 2 vCPU / 4 GB) with a domain pointing at it, Docker and Caddy
- Your own WhatsApp Business number (Meta's free test number works to start)
- A NEAR AI Cloud API key (cloud.near.ai, API Keys)
- Your own NEAR agent account with a full-access key (for example `mum-agent.near`, a little NEAR for gas). It must not be the wallet owner.
- The phone wallet's owner account (the guardian), to sign `set_agent`
- Locally: `git`, `node` 22 (for `scripts/setup.sh` checks), the `near` CLI (only for `set_agent`)

## 1. Get the code and write .env

```bash
git clone <your-fork-of-ringfence> ringfence && cd ringfence
scripts/setup.sh          # checks prerequisites, asks for values, writes .env (chmod 600)
```

`setup.sh` never echoes secrets and refuses to overwrite an existing `.env`. It starts on `NETWORK=testnet`; switch to `mainnet` only when you mean real money.

## 2. Firewall, container and HTTPS

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 40000:40100/udp && sudo ufw enable

docker build -t ringfence .
docker run -d --name ringfence --restart always --env-file .env -v /opt/ringfence-data:/app/data \
  -p 127.0.0.1:8787:8787 -p 40000-40100:40000-40100/udp ringfence

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/ringfence.example.com/<your-domain>/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The UDP range carries WhatsApp call audio. Port 8787 stays closed; only Caddy talks to it. Without Docker, use systemd: [deploy/README.md](deploy/README.md).

## 3. Your WhatsApp number

In developers.facebook.com, your app, WhatsApp:

1. Copy the token and phone number ID into `.env` (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`), plus the app secret (`WHATSAPP_APP_SECRET`).
2. Webhook URL: `https://<your-domain>/webhooks/whatsapp`, verify token = your `WHATSAPP_VERIFY_TOKEN`. Subscribe to `messages` and `calls`.
3. Check: `curl "https://<your-domain>/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=ok"` prints `ok`.

## 4. Point your wallet at your operator

The guardian (wallet owner) signs this once. It replaces the hosted agent with yours:

```bash
near contract call-function as-transaction <mum-wallet-account> set_agent \
  json-args '{"agent":"mum-agent.near"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' \
  sign-as <guardian-account> network-config mainnet sign-with-keychain send
```

Back to hosted, or to nobody: call `set_agent` again with `ringfence-agent.near`, or `revoke_agent` (also 1 yoctoNEAR) to stop all agent spending. `withdraw` always works for the owner.

## 5. Test

Call your WhatsApp number and say "send 0.1 NEAR to liho.near". Expect the PIN prompt, then a transfer within the limits. Over the limit, you get a link to sign it yourself.

## Updating

```bash
git pull && docker build -t ringfence . && docker rm -f ringfence && <the docker run line above>
```
