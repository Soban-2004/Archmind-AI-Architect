#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/deploy/production.env"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/compose.production.yml" ps
curl --fail --silent --show-error "${PUBLIC_ORIGIN}/api/health"
printf '\n'
curl --fail --silent --show-error --output /dev/null "${PUBLIC_ORIGIN}/"
echo "Frontend and API are reachable at ${PUBLIC_ORIGIN}."
