#!/bin/sh
# Ship HEAD to the server. Waits until no call is on (up to 15 min), so a deploy never cuts someone off.
set -e
cd "$(dirname "$0")/.."
git push -q
for i in $(seq 1 90); do
  n=$(curl -s https://ringfence.evalengine.ai/api/live-calls | grep -o '"calls":[0-9]*' | cut -d: -f2)
  [ "${n:-0}" = "0" ] && break
  echo "deploy: $n call(s) on, waiting"; sleep 10
done
git archive HEAD | ssh -i ~/.ssh/id_ed25519 ubuntu@98.88.234.196 'cd /opt/ringfence && sudo -u ringfence tar -x && sudo -u ringfence npm install --no-audit --no-fund --silent >/dev/null 2>&1 && sudo -u ringfence npm run build >/dev/null 2>&1 && sudo systemctl restart ringfence && sleep 4 && systemctl is-active ringfence'
npm run -s live:check | tail -1
