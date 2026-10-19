#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/apps/archmind
GATEWAY_DIR=/opt/apps/gateway
SOURCE_ENV=/tmp/.env
ARCHIVE=/tmp/archmind-deploy.tgz

umask 077
sudo install -d -m 0755 -o ubuntu -g ubuntu "${APP_DIR}" "${GATEWAY_DIR}"
tar -xzf "${ARCHIVE}" -C "${APP_DIR}"

if ! grep -Eq '^GROQ_API_KEY=.+$' "${SOURCE_ENV}"; then
  echo "The uploaded backend environment does not contain GROQ_API_KEY." >&2
  exit 1
fi

cp "${SOURCE_ENV}" "${APP_DIR}/deploy/production.env"
sed -i \
  -e '/^SUPABASE_DB_URL=/d' \
  -e '/^CORS_ORIGINS=/d' \
  -e '/^OLLAMA_API_KEY=/d' \
  -e '/^POSTGRES_DB=/d' \
  -e '/^POSTGRES_USER=/d' \
  -e '/^POSTGRES_PASSWORD=/d' \
  -e '/^PUBLIC_ORIGIN=/d' \
  "${APP_DIR}/deploy/production.env"

cat >> "${APP_DIR}/deploy/production.env" <<EOF
PUBLIC_ORIGIN=https://140.245.234.125
POSTGRES_DB=archmind
POSTGRES_USER=archmind
POSTGRES_PASSWORD=$(openssl rand -hex 32)
EOF
chmod 600 "${APP_DIR}/deploy/production.env"

cp "${APP_DIR}/deploy/gateway-compose.yml" "${GATEWAY_DIR}/compose.yml"
cp "${APP_DIR}/deploy/Caddyfile" "${GATEWAY_DIR}/Caddyfile"
cat > "${GATEWAY_DIR}/gateway.env" <<'EOF'
ARCHMIND_ADDRESS=140.245.234.125
DEFAULT_SNI=140.245.234.125
EOF
chmod 600 "${GATEWAY_DIR}/gateway.env"
chmod +x "${APP_DIR}"/deploy/*.sh

rm -f "${SOURCE_ENV}" "${ARCHIVE}"

docker compose --env-file "${APP_DIR}/deploy/production.env" \
  -f "${APP_DIR}/compose.production.yml" config --quiet
docker compose --env-file "${GATEWAY_DIR}/gateway.env" \
  -f "${GATEWAY_DIR}/compose.yml" config --quiet

echo "Production files prepared under /opt/apps."
