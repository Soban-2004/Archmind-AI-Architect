#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/production.env"
BACKUP_DIR="${ROOT_DIR}/backups/postgres"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/archmind-${STAMP}.dump.gz"

docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.production.yml" exec -T postgres \
  pg_dump --format=custom --no-owner --username "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip -9 > "${OUTPUT}"

find "${BACKUP_DIR}" -type f -name 'archmind-*.dump.gz' -mtime +7 -delete
echo "Created ${OUTPUT}"
