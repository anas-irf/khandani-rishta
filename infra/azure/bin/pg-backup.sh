#!/usr/bin/env bash
# Streams a pg_dump of the production database to Cloudflare R2.
# Runs from pg-backup.service with settings from /etc/khandani/backup.env.
set -euo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET must be set}"

name="${PGDATABASE}-$(date -u +%Y-%m-%dT%H%M%SZ).dump"

# Stream straight to R2 so nothing large is written to the VM's disk.
pg_dump --format=custom --no-owner --no-privileges | rclone rcat "r2:${BACKUP_BUCKET}/${name}"

echo "Uploaded ${name} to ${BACKUP_BUCKET}"
