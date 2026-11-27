# Azure setup runbook

How to create and run the production API VM (`B2ats_v2`) and its PostgreSQL server. There is no staging environment: every merge to `main` deploys to production. Sizes, limits and the reasons behind them are in [docs/tech-stack.md](../../docs/tech-stack.md) (section 12).

| Path | What it is |
|---|---|
| `cloud-init.yaml` | First-boot setup for the VM: service account, swap, journald limit, `cloudflared` |
| `systemd/` | Units for the API and the nightly database dump. Each deploy installs them |
| `bin/deploy.sh` | Activates a release on the VM and rolls back if it doesn't become ready |
| `bin/pg-backup.sh` | Streams `pg_dump` output to Cloudflare R2 |
| `env/*.env.example` | Templates for the env files on the VM |

Everything lives in the resource group `rg-khandani` in **India South Central** (`indiasouthcentral`), the closest region the Azure for Students policy allows ("Allowed resource deployment regions": Sweden Central, India South Central, East Asia, Poland Central, Korea Central).

Keep every generated secret in a file outside the repository (the repository is public) and in your password manager.

## 1. Before you start

- Register the resource providers once: `Microsoft.Compute`, `Microsoft.Network`, `Microsoft.DBforPostgreSQL`, `Microsoft.CognitiveServices` (`az provider register -n <name>`).
- Create a monthly budget of $5 with alerts at 80% and 100%: Cost Management > Budgets.
- Create an SSH key pair for the VM admin user (`ssh-keygen -t ed25519`) and a second one for GitHub Actions deploys.
- Add the domain to Cloudflare (free plan) and point its nameservers there.

## 2. PostgreSQL server

```sh
az postgres flexible-server create -g rg-khandani -n pg-khandani -l indiasouthcentral \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --storage-auto-grow Disabled \
  --version 18 --zonal-resiliency Disabled --backup-retention 7 --geo-redundant-backup Disabled \
  --public-access None --admin-user kradmin --admin-password '<strong password>'
az postgres flexible-server parameter set -g rg-khandani -s pg-khandani \
  --name azure.extensions --value PG_TRGM,PG_STAT_STATEMENTS
```

Add a temporary firewall rule for your own IP, connect as the admin user and create the application login and database:

```sql
CREATE ROLE khandani_prod LOGIN PASSWORD '<strong password>';
GRANT khandani_prod TO CURRENT_USER;
CREATE DATABASE khandani_prod OWNER khandani_prod;
REVOKE CONNECT ON DATABASE khandani_prod FROM PUBLIC;
```

Then, still as the admin user but connected to `khandani_prod`:

```sql
-- On Azure the public schema of a new database belongs to azure_pg_admin, so the API's
-- migrations fail with "permission denied for schema public" until the app role owns it.
ALTER SCHEMA public OWNER TO khandani_prod;
-- Only members of azure_pg_admin may create extensions. Creating them here makes the
-- `CREATE EXTENSION IF NOT EXISTS` in the first migration a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Remove your IP from the firewall once the VM's IP is added (step 3).

## 3. The VM

```sh
az vm create -g rg-khandani -n vm-khandani-prod -l indiasouthcentral \
  --image Canonical:ubuntu-26_04-lts:server:latest --size Standard_B2ats_v2 \
  --admin-username azureuser --ssh-key-values ~/.ssh/<admin key>.pub \
  --os-disk-size-gb 64 --storage-sku Premium_LRS \
  --public-ip-sku Standard --public-ip-address-allocation static \
  --nsg-rule NONE --custom-data infra/azure/cloud-init.yaml
```

- The 64 GiB Premium SSD is the free P6 size. The 30 GiB default is billed.
- Allow SSH (22) in the VM's network security group from your own IP only, for the setup in steps 4 and 5.
- Add the VM's public IP to the PostgreSQL firewall.

## 4. Cloudflare Tunnel and Access

1. Zero Trust > Networks > Tunnels: create a tunnel `khandani-prod` and copy its token (or use the Cloudflare API with a token that has Cloudflare Tunnel Edit).
2. On the VM: `sudo cloudflared service install <token>`.
3. Add the tunnel's public hostnames: `api.khandanirishta.app` to `http://localhost:8080`, `ssh.khandanirishta.app` to `ssh://localhost:22`.
4. Zero Trust > Access > Applications: add a self-hosted application for `ssh.khandanirishta.app`. Allow your own email (one-time PIN), plus a Service Auth rule for a service token used by GitHub Actions (Access > Service credentials > Service tokens).
5. Remove the SSH rule from the VM's network security group, so it has no inbound rules. From now on, connect through Access (install `cloudflared` locally first):

   ```sh
   ssh -o ProxyCommand="cloudflared access ssh --hostname %h" azureuser@ssh.khandanirishta.app
   ```

## 5. Env files

On the VM, create the API env file from `env/api.env.example`:

```sh
sudo install -m 640 -o root -g khandani /dev/null /etc/khandani/api.env
sudoedit /etc/khandani/api.env
```

Do the same for `/etc/khandani/backup.env` from `env/backup.env.example`. Keep a copy of every env file in your password manager.

## 6. GitHub settings for deploys

Create the environment `production` (Settings > Environments) and limit it to the `main` branch.

| Name | Kind | Where | Value |
|---|---|---|---|
| `SSH_HOST` | Variable | `production` | `ssh.khandanirishta.app` |
| `SSH_USER` | Variable | `production` | `azureuser` |
| `API_BASE_URL` | Variable | `production` | `https://api.khandanirishta.app`. Also the target of the API smoke test after each deploy |
| `WEB_URL` | Variable | `production` | `https://khandanirishta.app`. The web smoke tests run against it after each deploy; leave it unset to skip them |
| `CLERK_PUBLISHABLE_KEY` | Variable | `production` | The Clerk Production instance key (`pk_live_...`), built into the web app |
| `SENTRY_DSN_WEB` | Variable | `production` | DSN of the Sentry web project, used by the browser and the Worker. Empty turns reporting off |
| `SSH_PRIVATE_KEY` | Secret | `production` | The deploy key whose public half is in the VM's `~/.ssh/authorized_keys` |
| `SSH_KNOWN_HOSTS` | Secret | `production` | `ssh.khandanirishta.app ` followed by the VM's `/etc/ssh/ssh_host_ed25519_key.pub` |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Secret | `production` | The Access service token |
| `CLOUDFLARE_API_TOKEN` | Secret | `production` | API token with Workers Scripts Edit, Workers Routes Edit and R2 Edit |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Secret | `production` | Android release signing |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Repository | Cloudflare account ID |
| `CF_ANALYTICS_TOKEN` | Secret | Repository | Read-only Cloudflare token (Account Analytics Read) for the daily usage check (section 8) |
| `DEPLOY_ENABLED` | Variable | Repository | `true` once everything above exists. Until then, workflows build and test but never deploy |

The web Worker reads one secret at run time, the Clerk secret key of the Production instance. Set it from `apps/web`: `pnpm exec wrangler secret put CLERK_SECRET_KEY`.

## 7. First deploy

- Set `DEPLOY_ENABLED` to `true`, then Actions > CD > Run workflow on `main`. After that, every merge to `main` deploys.
- Turn on backups on the VM and test them once:

  ```sh
  sudo systemctl enable --now pg-backup.timer
  sudo systemctl start pg-backup.service
  journalctl -u pg-backup -n 20 --no-pager
  ```

## 8. Cost guards and alerts

Everything is meant to cost $0. These guards make a charge, or a free limit about to run out, show up in your email.

| Guard | What it does |
|---|---|
| Azure for Students spending limit | On by default. Azure can't charge a card; when the credit or the free year runs out, resources stop instead |
| Budget `khandani-monthly-5usd` | Emails at any spend (1%, 5 cents), 80%, 100% and a 100% forecast of $5 a month |
| Action group `ag-khandani-email` | Email receiver for the alerts below |
| `alert-pg-storage-80` | PostgreSQL storage above 80% of 32 GiB. Auto-grow is off, so at 100% writes fail rather than bill |
| `alert-pg-backup-storage` | Backup storage above 24 GiB of the free 32 GiB |
| `alert-vm-egress-daily` | The VM sent more than 450 MB in a day, the pace at which the free 15 GB a month runs out |
| R2 lifecycle rules | All buckets abort unfinished multipart uploads after 1 day (they count as storage); `kr-backups` deletes dumps after 30 days |
| Usage watch (`.github/workflows/usage-watch.yml`) | Daily. Fails, and GitHub emails you, when R2 storage reaches 8 GB, R2 Class A or B operations reach 80% of the month's free amount (or are on pace to pass it), Workers requests reach 80,000 in a day, or a date in `scripts/ci/usage-watch.mjs` is close. Cloudflare's own usage alerts need a paid plan |

The first 10 Azure metric alert series and 1,000 alert emails a month are free. R2 is the only service in the stack that bills a card automatically. Workers Free refuses requests past its limit instead of billing.

## Day-to-day

| Task | Command (on the VM) |
|---|---|
| Follow API logs | `journalctl -u khandani-api -f` |
| Apply an env file change | `sudo systemctl restart khandani-api` |
| See installed releases | `ls -t /opt/khandani/releases` |
| Roll back by hand | `/opt/khandani/releases/<id>/bin/deploy.sh <id>` |
