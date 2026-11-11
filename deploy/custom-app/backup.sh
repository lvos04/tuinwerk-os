#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 9>/data/config/backup.lock
flock -n 9 || { echo "Another backup or restore is running" >&2; exit 1; }
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to the public encryption recipient}"
work=$(mktemp -d /data/backups/.working-XXXXXX)
paused=0
cleanup(){ result=$?; if [[ $result != 0 ]]; then date -u +%FT%TZ > /data/status/last-backup-failure; chmod 644 /data/status/last-backup-failure; fi; rm -rf "$work"; if [[ $paused == 1 ]]; then supervisorctl -c /opt/tuinwerk/supervisord.conf start api worker web >/dev/null; fi; }
trap cleanup EXIT
paused=1
supervisorctl -c /opt/tuinwerk/supervisord.conf stop api worker web >/dev/null
pg_dump "$DATABASE_URL" -Fc > "$work/database.dump"
tar -C /data -cf "$work/files.tar" uploads exports
printf 'format=1\ncreated=%s\n' "$(date -u +%FT%TZ)" > "$work/manifest.txt"
(cd "$work" && sha256sum database.dump files.tar > SHA256SUMS)
archive="/data/backups/tuinwerk-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.age"
tar -C "$work" -cf - . | age -r "$AGE_RECIPIENT" -o "$archive.partial"
mv "$archive.partial" "$archive"
date -u +%FT%TZ > /data/status/last-backup-success
chmod 644 /data/status/last-backup-success
supervisorctl -c /opt/tuinwerk/supervisord.conf start api worker web >/dev/null
paused=0
if [[ ${BACKUP_RETENTION_APPLY:-false} == true ]]; then
  python3 /opt/tuinwerk/retention.py /data/backups --daily "${BACKUP_KEEP_DAILY:-30}" --monthly "${BACKUP_KEEP_MONTHLY:-12}" --apply || echo 'Retention failed; encrypted backup is preserved.' >&2
fi
printf '%s\n' "$archive"
