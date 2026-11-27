#!/usr/bin/env bash
# Dumps the production database and uploads it to Cloudflare R2.
# Runs from pg-backup.service with settings from /etc/khandani/backup.env.
#
# The upload is one signed S3 PUT with curl. rclone from the Ubuntu archive (1.60) gets
# "501 NotImplemented" from R2 even for tiny files, and curl is already on the VM. The dump
# goes to a private temporary file first, because a PUT needs its length up front. A single
# R2 PUT takes up to 5 GiB, far more than a custom-format dump of this database.
set -euo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET must be set}"
: "${R2_ENDPOINT:?R2_ENDPOINT must be set}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID must be set}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY must be set}"

name="${PGDATABASE}-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
dump="$(mktemp)"
trap 'rm -f "${dump}"' EXIT

pg_dump --format=custom --no-owner --no-privileges --file="${dump}"

# The credentials go to curl on stdin (-K -), so they never appear in the process list.
printf 'user = "%s:%s"\n' "${R2_ACCESS_KEY_ID}" "${R2_SECRET_ACCESS_KEY}" |
  curl --config - --fail --silent --show-error \
    --aws-sigv4 "aws:amz:auto:s3" \
    --header "Content-Type: application/octet-stream" \
    --upload-file "${dump}" \
    "${R2_ENDPOINT%/}/${BACKUP_BUCKET}/${name}"

echo "Uploaded ${name} ($(stat -c %s "${dump}") bytes) to ${BACKUP_BUCKET}"
