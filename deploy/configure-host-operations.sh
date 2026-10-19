#!/usr/bin/env bash
set -euo pipefail

sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

sudo systemctl restart docker

/opt/apps/archmind/deploy/backup-postgres.sh

CRON_JOB='20 2 * * * /opt/apps/archmind/deploy/backup-postgres.sh >> /opt/apps/archmind/backups/backup.log 2>&1'
(
  crontab -l 2>/dev/null | grep -vF '/opt/apps/archmind/deploy/backup-postgres.sh' || true
  echo "${CRON_JOB}"
) | crontab -

echo "Docker log rotation and daily database backup are configured."
