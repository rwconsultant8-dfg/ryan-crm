#!/usr/bin/env bash
set -euo pipefail
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -d -m 0700 /root/telegram-ai/codex-worker
if [ "$base/worker.py" != /root/telegram-ai/codex-worker/worker.py ]; then
  install -m 0700 "$base/worker.py" /root/telegram-ai/codex-worker/worker.py
fi
if [ -f "$base/worker-config.json" ]; then
  install -m 0600 "$base/worker-config.json" /root/telegram-ai/ryan-codex-worker.json
fi
python3 /root/telegram-ai/codex-worker/worker.py --config /root/telegram-ai/ryan-codex-worker.json --check-login
install -m 0644 "$base/ryan-codex-worker.service" /etc/systemd/system/ryan-codex-worker.service
systemctl daemon-reload
systemctl enable --now ryan-codex-worker.service
systemctl is-active --quiet ryan-codex-worker.service
printf '%s\n' 'Worker started. Use the CRM supervisor AI check to verify a completed round trip.'
