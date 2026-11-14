#!/usr/bin/env bash
# Destructive restore only into an explicitly confirmed empty test/new installation.
set -Eeuo pipefail
umask 077
: "${RESTORE_CONFIRM:?Set RESTORE_CONFIRM=EMPTY_DATABASE_AND_UPLOADS after checking target}"
[[ $RESTORE_CONFIRM == EMPTY_DATABASE_AND_UPLOADS ]] || exit 2
: "${AGE_IDENTITY:?Set path to private age identity kept outside the NAS}"
archive=${1:?Usage: scripts/restore.sh archive.tar.age}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Archives must come from a trusted operator-controlled backup source.
age -d -i "$AGE_IDENTITY" "$archive" | tar -C "$work" -xf -
(cd "$work" && sha256sum -c SHA256SUMS)
docker compose stop web api >/dev/null
docker compose up -d db
until docker compose exec -T db pg_isready -U tuinwerk -d tuinwerk >/dev/null; do sleep 2; done
objects=$(docker compose exec -T db psql -U tuinwerk -d tuinwerk -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[[ $objects == 0 ]] || { echo 'Refusing restore: database is not empty.' >&2; exit 1; }
docker compose run --rm --no-deps --entrypoint node api -e "const fs=require('fs'); for(const p of ['/data/uploads','/data/exports']) if(fs.existsSync(p)&&fs.readdirSync(p).length) throw Error('Target must be empty: '+p)"
docker compose exec -T db pg_restore -U tuinwerk -d tuinwerk --no-owner --exit-on-error < "$work/database.dump"
docker compose run --rm --no-deps --entrypoint tar api -C /data -xf - < "$work/files.tar"
docker compose up -d
printf 'Restored. Verify accounts, tasks, media, inventory, recurrence and checksums before accepting traffic.\n'
