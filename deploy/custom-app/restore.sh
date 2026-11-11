#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 9>/data/config/backup.lock
flock -n 9 || { echo "Another backup or restore is running" >&2; exit 1; }
[[ ${RESTORE_CONFIRM:-} == REPLACE_THIS_INSTALLATION ]] || { echo 'Set RESTORE_CONFIRM=REPLACE_THIS_INSTALLATION only on a disposable new recovery installation.' >&2; exit 2; }
: "${AGE_IDENTITY:?Set path of private age identity}"
archive=${1:?Usage: /opt/tuinwerk/restore.sh /data/backups/archive.tar.age}
work=$(mktemp -d /data/backups/.restore-XXXXXX)
trap 'rm -rf "$work"' EXIT
age -d -i "$AGE_IDENTITY" "$archive" > "$work/archive.tar"
python3 /opt/tuinwerk/extract-safe.py outer "$work/archive.tar" "$work"
(cd "$work" && sha256sum -c SHA256SUMS)
python3 /opt/tuinwerk/extract-safe.py files "$work/files.tar" --check
supervisorctl -c /opt/tuinwerk/supervisord.conf stop backup api worker web >/dev/null
# This deliberate restore replaces the bootstrap database on the NEW recovery installation.
runuser -u postgres -- dropdb --force tuinwerk
runuser -u postgres -- createdb -O tuinwerk tuinwerk
pg_restore --dbname="$DATABASE_URL" --no-owner --exit-on-error < "$work/database.dump"
rm -rf /data/uploads /data/exports
python3 /opt/tuinwerk/extract-safe.py files "$work/files.tar" /data
chown -R node:node /data/uploads /data/exports
runuser -u node -- node /app/api/dist/migrate.js
supervisorctl -c /opt/tuinwerk/supervisord.conf start backup api worker web >/dev/null
printf 'Restore complete; verify records and photos before switching users to this server.\n'
