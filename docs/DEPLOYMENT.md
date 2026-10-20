# Deployment (staging / demo)

> Status: proposed with the staging deploy PR, 2026-10-20. This is a **staging and demo**
> setup on one server. Production (Phase 2 in the roadmap) moves to managed services in a KSA
> region; the app does not change, only where its environment variables point.

## Shape

One Linux server runs everything with Docker Compose
(`deploy/compose.yml`):

| Service     | What it is                                                                           |
| ----------- | ------------------------------------------------------------------------------------ |
| `caddy`     | The only public service. HTTPS with automatic certificates, reverse proxy.           |
| `web`       | The app image, `next start`.                                                         |
| `worker`    | The same image, `pnpm worker` (pg-boss schedules, ARCHITECTURE §8).                  |
| `migrate`   | One-off on every start: DB roles, `prisma migrate deploy`, the DEMO-AMB seed.        |
| `postgres`  | PostgreSQL 16, data in a Docker volume. Not reachable from outside.                  |
| `seaweedfs` | S3-compatible evidence store. Reachable from outside only for signed download links. |
| `mailpit`   | Demo inbox: all email is caught here, behind a login. No email leaves the server.    |

Three host names point at the server: the app (`<host>`), signed file links
(`files.<host>`) and the demo inbox (`mail.<host>`). Without a domain the server uses
`<ip-with-dashes>.sslip.io`, a free DNS name that resolves to the IP, so HTTPS works with
no DNS setup.

The image is built by GitHub Actions and stored in the repository's private GitHub
Container Registry. The **Deploy staging** workflow is started by hand: it builds the image,
copies `deploy/` to the server over SSH and runs `deploy/up.sh`, which pulls with the
workflow's own short-lived token.

### Where it runs

Any Ubuntu 24.04 server with a public IP works; nothing in `deploy/` is provider-specific.

- **Hostinger VPS (chosen by the owner for staging).** Plan **KVM 2** (2 vCPU, 8 GB RAM) or
  larger. Hostinger has **no data centre in Saudi Arabia or the Gulf**; its nearest VPS
  locations are Germany, France, the UK and India. Choose **Germany or France** (lowest
  latency to KSA). This is acceptable for a demo with fictional data only. It is **not** a
  home for real facility data under the PDPL, which expects data to stay in the Kingdom unless
  a transfer basis exists.
- **Google Cloud Dammam (`me-central2`).** The residency option: same setup, data in KSA.
  Steps in "Alternative: Google Cloud Dammam" below. Production goes to a KSA region in any
  case.

Why one server: cheap, nothing to wire up, and deleting the server deletes everything. The
app talks only to `DATABASE_*`, `S3_*` and `SMTP_*`, so moving to managed services later is a
change to environment variables, not code.

### Limits (accepted for staging, fixed before production)

- One server: no high availability. Backups are disk snapshots (below), not point-in-time.
- Email goes to the demo inbox, not to people. Invited users get their link from the inbox,
  or set `SMTP_*` in `deploy/.env` to a real provider.
- Secrets live in `deploy/.env` on the server (mode 600), not in a secret manager.
- No real patient data, as everywhere in this project. Use the demo framework or a licensed
  import only.

## One-time setup

### 1. Hostinger VPS

1. In hPanel, buy a **VPS → KVM 2** plan. Location: **Germany** (or France). Operating
   system: **Plain OS → Ubuntu 24.04**. Set a root password when asked.
2. Open the VPS in hPanel and note its **IPv4 address** (Overview page).
3. If the VPS **Firewall** is turned on (VPS → Security → Firewall), allow TCP 22, 80 and
   443 (and UDP 443).
4. Open **Browser terminal** (top right of the VPS page) and paste:

```bash
ssh-keygen -t ed25519 -f ~/mustamir-deploy -N "" -C deploy
mkdir -p ~/.ssh && cat ~/mustamir-deploy.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
cat ~/mustamir-deploy
```

5. Copy the private key it prints (from `-----BEGIN` to `END-----`) into the GitHub secret
   below, then remove it from the server: `rm ~/mustamir-deploy ~/mustamir-deploy.pub`.

### 2. GitHub settings

In the repository: **Settings → Secrets and variables → Actions**.

| Kind     | Name             | Value                                                            |
| -------- | ---------------- | ---------------------------------------------------------------- |
| Variable | `DEPLOY_HOST`    | The IP printed above.                                            |
| Variable | `DEPLOY_USER`    | `deploy`                                                         |
| Secret   | `DEPLOY_SSH_KEY` | The whole private key printed above, `-----BEGIN` to `END-----`. |
| Variable | `APP_DOMAIN`     | Optional. Your own host name; see "Own domain".                  |

Optional: `DEPLOY_KNOWN_HOSTS` (secret), the output of `ssh-keyscan <ip>`, pins the server's
key. Without it the workflow trusts the key it sees on first contact.

### 3. First deploy

**Actions → Deploy staging → Run workflow** on `main`. The first run takes about ten
minutes (it installs Docker on the server). The log ends with the app's address, for
example `https://34-166-1-2.sslip.io`.

Open it, create an account (it becomes the owner of a new organization) and set up
two-step verification. To make that account a platform admin (standards import, tiers), run
in the server's terminal (Hostinger: Browser terminal):

```bash
cd ~/mustamir && sudo docker compose run --rm migrate pnpm platform:admin you@example.com
```

The demo inbox is `https://mail.<host>`, user `admin`; the password is `MAIL_UI_PASSWORD`
in `~/mustamir/.env` on the server.

**Save a copy of `~/mustamir/.env`** in a password manager. It holds the database, auth and
storage secrets; without it the data cannot be reached.

## Every later deploy

Merge to `main`, then run **Deploy staging** again. Migrations run before the new version
starts. Data stays in the Docker volumes.

## Own domain

Point three DNS `A` records at the server IP: `staging.example.com`,
`files.staging.example.com` and `mail.staging.example.com`. Set the `APP_DOMAIN` variable to
`staging.example.com` and run the workflow. Caddy gets the certificates. Existing sessions
end, as cookies belong to the old host.

## Backups

Hostinger: VPS → **Backups & monitoring** (weekly backups are included; take a manual
snapshot before risky changes). Google Cloud: **Compute Engine → Snapshots → Create snapshot
schedule** (daily, keep 7) on the `mustamir-staging` disk.

## Operating

Run on the server, in `~/mustamir`:

```bash
sudo docker compose ps                 # what is running
sudo docker compose logs -f web worker # logs
sudo docker compose restart web        # restart one service
```

## Alternative: Google Cloud Dammam

Use this instead of the Hostinger step when data must stay in KSA.

Create a Google Cloud account and a project with billing enabled
(https://console.cloud.google.com). Then open **Cloud Shell** (the `>_` icon at the top of
the console) and paste, replacing `PROJECT_ID`:

```bash
gcloud config set project PROJECT_ID
gcloud services enable compute.googleapis.com
gcloud compute addresses create mustamir-ip --region=me-central2
gcloud compute instances create mustamir-staging \
  --zone=me-central2-a --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --address=mustamir-ip --tags=mustamir-web
gcloud compute firewall-rules create mustamir-web \
  --allow=tcp:80,tcp:443,udp:443 --target-tags=mustamir-web
ssh-keygen -t ed25519 -f ~/mustamir-deploy -N "" -C deploy
gcloud compute instances add-metadata mustamir-staging --zone=me-central2-a \
  --metadata=ssh-keys="deploy:$(cat ~/mustamir-deploy.pub)"
echo "DEPLOY_HOST = $(gcloud compute addresses describe mustamir-ip --region=me-central2 --format='get(address)')"
echo "DEPLOY_SSH_KEY:"; cat ~/mustamir-deploy
```

Then continue with "2. GitHub settings" with `DEPLOY_USER` = `deploy`. To run commands on
the server later: `gcloud compute ssh deploy@mustamir-staging --zone=me-central2-a`.

## Before production

Managed Postgres with point-in-time recovery, a regional object store with server-side
encryption, a KSA email (and later SMS) provider, secrets in the cloud secret manager, at
least two app instances behind a load balancer, monitoring and alerting, and a
security review (M16). M15 adds Chromium to the image for the PDF reports.
