# OCI production deployment

This bundle runs ArchMind on a shared OCI Ampere A1 application host. One
server-wide Caddy gateway owns ports 80 and 443 so two additional projects can
be added later. ArchMind's Next.js and FastAPI containers join the shared
gateway network with unique aliases. PostgreSQL stays on ArchMind's private
network. Images used here publish both ARM64 and AMD64 variants.

## Before deployment

In OCI, attach an NSG that allows TCP 80 and 443 from `0.0.0.0/0`, and TCP 22
only from the administrator's public IP. Do not expose 3000, 8000, or 5432.

The production source must include the intended local changes. Do not clone an
older Git branch and assume it contains uncommitted workstation changes.

## Install and start

Use this server layout:

```text
/opt/apps/gateway
/opt/apps/archmind
/opt/apps/project-2
/opt/apps/project-3
```

On the Ubuntu instance, from `/opt/apps/archmind`:

```bash
chmod +x deploy/*.sh
./deploy/install-docker-ubuntu.sh
exit
```

Reconnect, then create the production environment:

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
openssl rand -hex 32
nano deploy/production.env
```

Set the generated value as `POSTGRES_PASSWORD`, add the provider keys, and
set `PUBLIC_ORIGIN=https://140.245.234.125` for the public IP deployment.
Configure and start the shared gateway separately:

```bash
cp deploy/gateway.env.example /opt/apps/gateway/gateway.env
cp deploy/gateway-compose.yml /opt/apps/gateway/compose.yml
cp deploy/Caddyfile /opt/apps/gateway/Caddyfile
docker compose --env-file /opt/apps/gateway/gateway.env \
  -f /opt/apps/gateway/compose.yml up -d
```

```bash
docker compose --env-file deploy/production.env -f compose.production.yml config --quiet
docker compose --env-file deploy/production.env -f compose.production.yml up -d --build
./deploy/verify.sh
```

The database schema initializes automatically only when the PostgreSQL volume
is empty. Re-running Compose preserves the named database volume.

## HTTPS

The default gateway configuration obtains a trusted, short-lived Let's Encrypt
certificate for `https://140.245.234.125` and redirects HTTP requests to HTTPS.
The certificate renews automatically and its state is stored in the
`caddy-data` volume.

## Use a custom domain

Create a DNS `A` record pointing the chosen hostname to the VM. Then update:

```env
PUBLIC_ORIGIN=https://archmind.example.com
```

Set `ARCHMIND_ADDRESS=archmind.example.com` in
`/opt/apps/gateway/gateway.env`, and set `DEFAULT_SNI` to the same hostname.

Apply it with:

```bash
docker compose --env-file /opt/apps/gateway/gateway.env \
  -f /opt/apps/gateway/compose.yml up -d
docker compose --env-file deploy/production.env -f compose.production.yml up -d
./deploy/verify.sh
```

Caddy obtains and renews the domain certificate automatically.

## Backups

Create a backup manually:

```bash
./deploy/backup-postgres.sh
```

Schedule it daily with the absolute repository path in the `ubuntu` user's
crontab. Local backups are retained for seven days. Copy them to storage
outside this VM; a local backup alone does not survive loss of the boot volume.

Example cron entry:

```cron
20 2 * * * /opt/apps/archmind/deploy/backup-postgres.sh >> /opt/apps/archmind/backups/backup.log 2>&1
```

## Operations

```bash
docker compose --env-file deploy/production.env -f compose.production.yml ps
docker compose --env-file deploy/production.env -f compose.production.yml logs --tail=200
docker compose --env-file deploy/production.env -f compose.production.yml pull
docker compose --env-file deploy/production.env -f compose.production.yml up -d --build
```

After changing `NEXT_PUBLIC_API_URL`, rebuild the frontend because Next.js
inlines public environment variables at build time.
