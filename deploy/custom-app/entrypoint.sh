#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PG_BIN=${PG_BIN:-/usr/bin}
PG_MAJOR=${PG_MAJOR:-17}
mkdir -p /data/postgres /data/uploads /data/exports /data/backups /data/config /data/status /run/postgresql /run/nginx
chown postgres:postgres /data/postgres /run/postgresql
chown node:node /data/uploads /data/exports
chmod 700 /data/postgres /data/backups /data/config
chmod 755 /data/status
if [[ ! -s /data/postgres/PG_VERSION ]]; then
  runuser -u postgres -- "$PG_BIN/initdb" -D /data/postgres --encoding=UTF8 --locale=C --auth-local=peer --auth-host=trust
  # Database listens exclusively inside this single container, never on its LAN interface.
  printf "\nlisten_addresses='127.0.0.1'\n" >> /data/postgres/postgresql.conf
fi
[[ $(cat /data/postgres/PG_VERSION) == "$PG_MAJOR" ]] || { echo 'Unsupported database major version: restore a logical backup into a new dataset.' >&2; exit 1; }
# Local administration requires peer identity; application TCP can only assume its own DB role.
cat > /data/postgres/pg_hba.conf <<'HBA'
local all all peer
host tuinwerk tuinwerk 127.0.0.1/32 trust
host all all 0.0.0.0/0 reject
host all all ::/0 reject
HBA
chown postgres:postgres /data/postgres/pg_hba.conf
chmod 600 /data/postgres/pg_hba.conf
runuser -u postgres -- "$PG_BIN/pg_ctl" -D /data/postgres -w start
trap 'runuser -u postgres -- "$PG_BIN/pg_ctl" -D /data/postgres -m fast -w stop || true' EXIT
if ! runuser -u postgres -- psql -Atc "SELECT 1 FROM pg_roles WHERE rolname='tuinwerk'" | grep -qx 1; then runuser -u postgres -- createuser tuinwerk; fi
if ! runuser -u postgres -- psql -Atc "SELECT 1 FROM pg_database WHERE datname='tuinwerk'" | grep -qx 1; then runuser -u postgres -- createdb -O tuinwerk tuinwerk; fi
runuser -u node -- node /app/api/dist/migrate.js
if [[ -n ${ADMIN_EMAIL:-} && -n ${ADMIN_PASSWORD:-} ]]; then runuser -u node -- node /app/api/dist/bootstrap.js; fi
runuser -u postgres -- "$PG_BIN/pg_ctl" -D /data/postgres -m fast -w stop
trap - EXIT
exec /usr/bin/supervisord -n -c /opt/tuinwerk/supervisord.conf
