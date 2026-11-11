#!/usr/bin/env bash
set -uo pipefail
# Optional daily backup: disabled until a public encryption recipient is configured.
interval=${BACKUP_INTERVAL_SECONDS:-86400}
[[ $interval =~ ^[0-9]+$ && $interval -ge 3600 ]] || { echo 'BACKUP_INTERVAL_SECONDS must be at least 3600'; exit 2; }
sleep 60
while true; do
  if [[ -n ${AGE_RECIPIENT:-} ]]; then
    if /opt/tuinwerk/backup.sh; then
      date -u +%FT%TZ > /data/status/last-backup-success
    else
      echo 'Encrypted backup failed; check logs and free storage.' >&2
      date -u +%FT%TZ > /data/status/last-backup-failure
    fi
    chmod 644 /data/status/last-backup-*
  fi
  sleep "$interval" & wait $!
done
