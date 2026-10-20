# Deployment (staging / demo)

> Status: proposed with the staging deploy PR, 2026-10-20. This is a **staging and demo**
> setup on one server. Production (Phase 2 in the roadmap) moves to managed services in a KSA
> region; the app does not change, only where its environment variables point.

## Shape

One Linux server in a Saudi cloud region runs everything with Docker Compose
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

### Why this shape

- **Data residency (PDPL).** Every byte (database, evidence files, email) stays on one
  server in a KSA region. Nothing goes to a US-hosted PaaS, mail service or identity provider.
- **Cheap and easy to throw away.** One small VM (about USD 40 a month in Dammam, covered by
  Google Cloud's free trial credit), no managed services to wire up. Deleting the VM deletes
  everything.
- **Same image as production later.** The app already talks only to `DATABASE_*`, `S3_*` and
  `SMTP_*`; moving to Cloud SQL, a regional object store and a KSA email provider is a change
  to environment variables.

### Limits (accepted for staging, fixed before production)

- One server: no high availability. Backups are disk snapshots (below), not point-in-time.
- Email goes to the demo inbox, not to people. Invited users get their link from the inbox,
  or set `SMTP_*` in `deploy/.env` to a real provider.
- Secrets live in `deploy/.env` on the server (mode 600), not in a secret manager.
- No real patient data, as everywhere in this project. Use the demo framework or a licensed
  import only.

## One-time setup

### 1. Google Cloud server (Dammam, `me-central2`)

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

Keep the Cloud Shell tab open for the next step.

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
two-step verification. To make that account a platform admin (standards import, tiers):

```bash
gcloud compute ssh deploy@mustamir-staging --zone=me-central2-a -- \
  'cd ~/mustamir && sudo docker compose run --rm migrate pnpm platform:admin you@example.com'
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

Google Cloud console → **Compute Engine → Snapshots → Create snapshot schedule** (daily,
keep 7), attached to the `mustamir-staging` disk, in `me-central2`.

## Operating

Run on the server, in `~/mustamir`:

```bash
sudo docker compose ps                 # what is running
sudo docker compose logs -f web worker # logs
sudo docker compose restart web        # restart one service
```

## Before production

Managed Postgres with point-in-time recovery, a regional object store with server-side
encryption, a KSA email (and later SMS) provider, secrets in the cloud secret manager, at
least two app instances behind a load balancer, monitoring and alerting, and a
security review (M16). M15 adds Chromium to the image for the PDF reports.
