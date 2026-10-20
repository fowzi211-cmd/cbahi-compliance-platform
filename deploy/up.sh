#!/usr/bin/env bash
# Starts or updates the staging deployment on this server (docs/DEPLOYMENT.md).
#
#   bash up.sh <image> [domain] [registry-user]
#
# <image>   the app image to run, e.g. ghcr.io/owner/repo:<sha>
# [domain]  the app's host name. Leave it out to use <server-ip>.sslip.io, which needs no DNS.
# [registry-user]  the account the piped registry token belongs to.
#
# A registry token, when one is piped in on stdin, is used to pull a private image. The
# GitHub workflow pipes its own short-lived token, so no long-lived key is kept here.
set -euo pipefail
cd "$(dirname "$0")"

image="${1:?usage: up.sh <image> [domain]}"
domain="${2:-}"
registry_user="${3:-deploy}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
fi
docker=(docker)
docker info >/dev/null 2>&1 || docker=(sudo docker)

if [ ! -t 0 ]; then
  token="$(cat)"
  if [ -n "$token" ]; then
    printf '%s' "$token" | "${docker[@]}" login ghcr.io -u "$registry_user" --password-stdin >/dev/null
  fi
fi

secret() { openssl rand -hex 24; }

# Secrets are generated here once and never leave the server. Keep a copy of this file in a
# password manager: without it the database and stored files cannot be reached.
if [ ! -f .env ]; then
  if [ -z "$domain" ]; then
    ip="$(curl -fsS https://api.ipify.org)"
    domain="${ip//./-}.sslip.io"
  fi
  umask 077
  cat >.env <<ENV
APP_IMAGE=$image
APP_HOST=$domain
FILES_HOST=files.$domain
MAIL_HOST=mail.$domain
POSTGRES_PASSWORD=$(secret)
APP_DB_PASSWORD=$(secret)
AUTH_DB_PASSWORD=$(secret)
SYSTEM_DB_PASSWORD=$(secret)
BETTER_AUTH_SECRET=$(secret)
S3_ACCESS_KEY_ID=mustamir-$(openssl rand -hex 6)
S3_SECRET_ACCESS_KEY=$(secret)
MAIL_UI_PASSWORD=$(openssl rand -hex 8)
ENV
  echo "Wrote $(pwd)/.env with new secrets."
fi

# The image changes on every deploy; a domain given later moves the app to it.
sed -i "s|^APP_IMAGE=.*|APP_IMAGE=$image|" .env
if [ -n "$domain" ]; then
  sed -i -e "s|^APP_HOST=.*|APP_HOST=$domain|" -e "s|^FILES_HOST=.*|FILES_HOST=files.$domain|" \
    -e "s|^MAIL_HOST=.*|MAIL_HOST=mail.$domain|" .env
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# The file store reads its access keys from a file, so it is written from .env each time.
umask 077
cat >seaweedfs-s3.json <<JSON
{
  "identities": [
    {
      "name": "mustamir",
      "credentials": [{ "accessKey": "$S3_ACCESS_KEY_ID", "secretKey": "$S3_SECRET_ACCESS_KEY" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
chmod 644 seaweedfs-s3.json

"${docker[@]}" compose pull --quiet
"${docker[@]}" compose up -d --remove-orphans --wait web worker caddy mailpit

echo
echo "Mustamir is up:  https://$APP_HOST"
echo "Demo inbox:      https://$MAIL_HOST  (user admin, password MAIL_UI_PASSWORD in $(pwd)/.env)"
