#!/usr/bin/env bash
# Ringfence self-host setup: checks prerequisites and writes .env from prompts. Secrets are read silently and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ok=1
for c in git node docker; do command -v "$c" >/dev/null || { echo "missing: $c"; ok=0; }; done
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "need node 22+"; ok=0; }
command -v caddy >/dev/null || echo "note: caddy not found (needed on the VPS for HTTPS)"
command -v near >/dev/null || echo "note: near CLI not found (needed once, for set_agent)"
[ "$ok" = 1 ] || exit 1

[ -e .env ] && { echo ".env already exists; move it away to start again."; exit 1; }

ask()    { local v; read -r -p "$1: " v; printf '%s' "$v"; }
secret() { local v; read -r -s -p "$1 (hidden): " v; echo >&2; printf '%s' "$v"; }

NETWORK=$(ask "Network [testnet/mainnet] (default testnet)"); NETWORK=${NETWORK:-testnet}
[[ "$NETWORK" =~ ^(testnet|mainnet)$ ]] || { echo "network must be testnet or mainnet"; exit 1; }
DOMAIN=$(ask "Your domain (e.g. ringfence.example.com)")
NEARAI=$(secret "NEAR AI API key")
WA_TOKEN=$(secret "WhatsApp token")
WA_PHONE=$(ask "WhatsApp phone number ID")
WA_SECRET=$(secret "WhatsApp app secret")
WA_VERIFY=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
AGENT_ID=$(ask "Your agent account (e.g. mum-agent.near)")
AGENT_KEY=$(secret "Agent private key (ed25519:...)")
[[ -z "$AGENT_KEY" || "$AGENT_KEY" == ed25519:* ]] || { echo "agent key must start with ed25519:"; exit 1; }

umask 077
cat > .env <<ENV
NETWORK=$NETWORK
PUBLIC_URL=https://$DOMAIN
NEARAI_API_KEY=$NEARAI
WHATSAPP_TOKEN=$WA_TOKEN
WHATSAPP_PHONE_NUMBER_ID=$WA_PHONE
WHATSAPP_APP_SECRET=$WA_SECRET
WHATSAPP_VERIFY_TOKEN=$WA_VERIFY
AGENT_ACCOUNT_ID=$AGENT_ID
AGENT_PRIVATE_KEY=$AGENT_KEY
RTC_PORT_MIN=40000
RTC_PORT_MAX=40100
ENV
echo "wrote .env (mode 600). Webhook verify token is in .env as WHATSAPP_VERIFY_TOKEN."
echo "next: SELF-HOST.md step 2 (docker + Caddy), then step 4 (set_agent to $AGENT_ID)."
