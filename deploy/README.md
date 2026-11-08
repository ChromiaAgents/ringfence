# Deploy on a plain Linux VPS

One Ubuntu 24.04 box (Hetzner or DigitalOcean, **Singapore** region), 2 vCPU / 4 GB is plenty with `TTS_PROVIDER=cartesia` (no local voice model). With Kokoro, take 4 vCPU. No Vercel: calls need a long-running process and inbound UDP.

Replace `ringfence.example.com` with your domain and point its DNS A record at the server's IP first.

## 1. Firewall

Cloud firewall (Hetzner: Firewalls; DigitalOcean: Networking → Firewalls) and `ufw` on the box, the same rules:

| Port | Protocol | Why |
| --- | --- | --- |
| 22 | TCP | SSH (limit to your IP if you can) |
| 80, 443 | TCP | Caddy: HTTPS and the certificate challenge |
| 40000–40100 | UDP | WhatsApp call audio (werift ICE, `RTC_PORT_MIN`/`RTC_PORT_MAX`) |

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 40000:40100/udp && sudo ufw enable
```

Port 8787 stays closed: only Caddy talks to it, on localhost.

## 2. Node, Caddy, the app

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs git
# Caddy (official apt repo)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# App, as its own user
sudo useradd --system --create-home --home-dir /opt/ringfence ringfence
sudo -u ringfence git clone git@github.com:ChromiaAgents/ringfence.git /opt/ringfence   # or rsync the repo
cd /opt/ringfence
sudo -u ringfence npm ci
sudo -u ringfence npm run build
```

## 3. .env

Copy the `.env` from Tan to `/opt/ringfence/.env` (never commit it), then set at least:

```
PUBLIC_URL=https://ringfence.example.com
RTC_PORT_MIN=40000
RTC_PORT_MAX=40100
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=sk_car_...
```

```bash
sudo chown ringfence:ringfence /opt/ringfence/.env && sudo chmod 600 /opt/ringfence/.env
```

## 4. Service and HTTPS

```bash
sudo cp /opt/ringfence/deploy/ringfence.service /etc/systemd/system/ringfence.service
sudo systemctl daemon-reload && sudo systemctl enable --now ringfence
journalctl -u ringfence -f            # expect "voice ready (cartesia + fillers ...)"

sudo cp /opt/ringfence/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/ringfence.example.com/<your-domain>/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 5. Check from outside

```bash
curl -I https://<your-domain>/                  # 200
curl "https://<your-domain>/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=ok"   # ok
```

Then point the Meta webhook at `https://<your-domain>/webhooks/whatsapp` (HANDOVER.md, Meta / WhatsApp) and place a WhatsApp call: the log should show `wa ice connected`. If it rings and nobody answers, the UDP range is not open.

## Docker instead of systemd

```bash
docker build -t ringfence .
docker run -d --name ringfence --restart always --env-file .env -v /opt/ringfence-data:/app/data \
  -p 127.0.0.1:8787:8787 -p 40000-40100:40000-40100/udp ringfence
```

Caddy stays on the host as above. Keep `data/` on the volume.

## Update

```bash
cd /opt/ringfence && sudo -u ringfence git pull && sudo -u ringfence npm ci && sudo -u ringfence npm run build && sudo systemctl restart ringfence
```
