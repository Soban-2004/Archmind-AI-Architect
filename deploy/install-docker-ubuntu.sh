#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script must run on the OCI Ubuntu instance." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
ARCHITECTURE="$(dpkg --print-architecture)"
echo "deb [arch=${ARCHITECTURE} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
sudo install -d -m 0755 -o "$USER" -g "$USER" /opt/apps
sudo install -d -m 0755 -o "$USER" -g "$USER" /opt/apps/gateway
sudo docker network inspect shared-gateway >/dev/null 2>&1 || sudo docker network create shared-gateway

echo "Docker installed. Sign out and reconnect once so the new docker group is active."
