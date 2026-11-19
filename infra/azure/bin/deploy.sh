#!/usr/bin/env bash
# Activates an uploaded API release on this VM, and rolls back if it doesn't become ready.
#
# Usage: deploy.sh <release-id>
# The release must already be unpacked in /opt/khandani/releases/<release-id>/.
set -euo pipefail

release_id="${1:?usage: deploy.sh <release-id>}"
root=/opt/khandani
release="${root}/releases/${release_id}"
ready_url="${READY_URL:-http://127.0.0.1:8080/readyz}"
keep_releases=5

if [[ ! -x "${release}/khandani-api" ]]; then
  echo "No executable at ${release}/khandani-api" >&2
  exit 1
fi

previous="$(readlink -e "${root}/current" || true)"

activate() {
  ln -sfn "$1" "${root}/current.next"
  mv -Tf "${root}/current.next" "${root}/current"
  sudo systemctl restart khandani-api
}

wait_until_ready() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "${ready_url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Install the systemd units shipped with the release. The backup timer is enabled
# by hand on the production VM only (see infra/azure/README.md).
sudo install -m 0644 "${release}"/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable khandani-api >/dev/null 2>&1

activate "${release}"

if wait_until_ready; then
  echo "Release ${release_id} is live"
  # Keep the newest releases for quick manual rollbacks.
  find "${root}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n +"$((keep_releases + 1))" \
    | cut -d' ' -f2- \
    | xargs -r rm -rf --
  exit 0
fi

echo "Release ${release_id} failed its readiness check" >&2
sudo journalctl -u khandani-api -n 50 --no-pager >&2 || true

if [[ -n "${previous}" && "${previous}" != "${release}" ]]; then
  echo "Rolling back to ${previous}" >&2
  activate "${previous}"
fi
exit 1
