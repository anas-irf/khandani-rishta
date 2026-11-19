# Azure setup runbook

How to create and run the two API VMs (production `B2ats_v2`, staging `B1s`) and the shared PostgreSQL server. Sizes, limits and the reasons behind them are in [docs/tech-stack.md](../../docs/tech-stack.md) (section 12).

| Path | What it is |
|---|---|
| `cloud-init.yaml` | First-boot setup for both VMs: service account, swap, journald limit, `cloudflared` |
| `systemd/` | Units for the API and the nightly database dump. Each deploy installs them |
| `bin/deploy.sh` | Activates a release on a VM and rolls back if it doesn't become ready |
| `bin/pg-backup.sh` | Streams `pg_dump` output to Cloudflare R2 |
| `env/*.env.example` | Templates for the env files on the VMs |

## 1. Before you start

- Check which regions the subscription allows: Azure portal > Policy > Assignments > "Allowed resource deployment regions". Use one region for everything.
- Create a budget alert at $5: Cost Management > Budgets.
- Create an SSH key pair for the VM admin user (`ssh-keygen -t ed25519`).
- Add the domain to Cloudflare (free plan).

## 2. PostgreSQL server (once)

Create "Azure Database for PostgreSQL flexible server":

- Compute: Burstable `B1MS`. Storage: 32 GiB, auto-grow off. PostgreSQL 18. High availability off. Backups: 7 days, locally redundant.
- Networking: public access. Firewall rules for the two VM IPs come in step 3.
- Server parameter `azure.extensions`: `PG_TRGM,PG_STAT_STATEMENTS` (add `POSTGIS` only if location search is needed).

Connect as the admin user and create one database and one login per environment:

```sql
CREATE ROLE khandani_prod LOGIN PASSWORD '<strong password>';
CREATE ROLE khandani_staging LOGIN PASSWORD '<strong password>';
GRANT khandani_prod, khandani_staging TO CURRENT_USER;
CREATE DATABASE khandani_prod OWNER khandani_prod;
CREATE DATABASE khandani_staging OWNER khandani_staging;
REVOKE CONNECT ON DATABASE khandani_prod FROM PUBLIC;
REVOKE CONNECT ON DATABASE khandani_staging FROM PUBLIC;
```

Then, connected to `khandani_prod`, run `CREATE EXTENSION pg_stat_statements;`.

## 3. The two VMs

Create each VM ("Virtual machine" in the portal):

| Setting | Production | Staging |
|---|---|---|
| Name | `vm-khandani-prod` | `vm-khandani-staging` |
| Size | `Standard_B2ats_v2` | `Standard_B1s` |
| Image | Ubuntu Server 26.04 LTS, x64 | same |
| Authentication | SSH public key, user `azureuser` | same |
| Inbound ports | SSH (22), from your IP only, for setup | same |
| OS disk | Premium SSD, **64 GiB** (the free P6 size, not the 30 GiB default) | same |
| Public IP | Standard, static | same |
| Advanced > Custom data | contents of `cloud-init.yaml` | same |

Afterwards, add each VM's public IP to the PostgreSQL firewall.

## 4. Cloudflare Tunnel and Access (each VM)

1. Cloudflare Zero Trust > Networks > Tunnels: create a tunnel (`khandani-prod`, `khandani-staging`) and copy its token.
2. On the VM: `sudo cloudflared service install <token>`.
3. Add the tunnel's public hostnames:

   | Hostname | Production | Staging |
   |---|---|---|
   | API | `api.<domain>` to `http://localhost:8080` | `api-staging.<domain>` to `http://localhost:8080` |
   | SSH | `ssh.<domain>` to `ssh://localhost:22` | `ssh-staging.<domain>` to `ssh://localhost:22` |

4. Zero Trust > Access > Applications: add a self-hosted application for each SSH hostname. Allow your own email (one-time PIN), plus a Service Auth rule for a service token used by GitHub Actions (Access > Service credentials > Service tokens).
5. Remove the SSH rule from the VM's network security group. From now on, connect through Access (install `cloudflared` locally first):

   ```sh
   ssh -o ProxyCommand="cloudflared access ssh --hostname %h" azureuser@ssh.<domain>
   ```

## 5. Env files

On each VM, create the API env file from `env/api.env.example`:

```sh
sudo install -m 640 -o root -g khandani /dev/null /etc/khandani/api.env
sudoedit /etc/khandani/api.env
```

On the production VM only, do the same for `/etc/khandani/backup.env` from `env/backup.env.example`. Keep a copy of every env file in your password manager.

## 6. GitHub settings for deploys

Create the environments `staging` and `production` (Settings > Environments). Limit `production` to the `main` branch.

| Name | Kind | Where | Value |
|---|---|---|---|
| `SSH_HOST` | Variable | Each environment | `ssh.<domain>` or `ssh-staging.<domain>` |
| `SSH_USER` | Variable | Each environment | `azureuser` |
| `API_BASE_URL` | Variable | Each environment | `https://api.<domain>` or `https://api-staging.<domain>` |
| `SSH_PRIVATE_KEY` | Secret | Each environment | A deploy key whose public half is in the VM's `~/.ssh/authorized_keys` |
| `SSH_KNOWN_HOSTS` | Secret | Each environment | `ssh.<domain> ` followed by the VM's `/etc/ssh/ssh_host_ed25519_key.pub` |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Secret | Each environment | The Access service token |
| `CLOUDFLARE_API_TOKEN` | Secret | Each environment | API token with Workers Scripts Edit and R2 Edit |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Secret | `production` | Android release signing |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Repository | Cloudflare account ID |
| `DEPLOY_ENABLED` | Variable | Repository | `true` once everything above exists. Until then, workflows build and test but never deploy |

## 7. First deploy

- Staging: merge to `main`. The API and Web workflows deploy automatically.
- Production: Actions > API (and Web) > Run workflow on `main`, with "Deploy this commit to production" ticked.
- Then turn on backups on the production VM and test them once:

  ```sh
  sudo systemctl enable --now pg-backup.timer
  sudo systemctl start pg-backup.service
  journalctl -u pg-backup -n 20 --no-pager
  ```

## Day-to-day

| Task | Command (on the VM) |
|---|---|
| Follow API logs | `journalctl -u khandani-api -f` |
| Apply an env file change | `sudo systemctl restart khandani-api` |
| See installed releases | `ls -t /opt/khandani/releases` |
| Roll back by hand | `/opt/khandani/releases/<id>/bin/deploy.sh <id>` |
