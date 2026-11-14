#!/usr/bin/env bash
# Run from repository root. Requires Docker Compose, age, tar and sha256sum.
set -Eeuo pipefail
umask 077
: "${BACKUP_DIR:?Set BACKUP_DIR outside the application datasets}"
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT to the public age recipient}"
command -v age >/dev/null
mkdir -p "$BACKUP_DIR"
work=$(mktemp -d)
paused=0
cleanup() { rm -rf "$work"; if [[ $paused == 1 ]]; then docker compose start api web >/dev/null; fi; }
trap cleanup EXIT
# Quiesce writes so DB and attachments form one consistent restore point.
paused=1
docker compose stop web api >/dev/null
docker compose exec -T db pg_dump -U tuinwerk -d tuinwerk -Fc > "$work/database.dump"
docker compose run --rm --no-deps --entrypoint tar api -C /data -cf - uploads exports > "$work/files.tar"
printf 'format=1\ncreated=%s\nrevision=%s\n' "$(date -u +%FT%TZ)" "$(git rev-parse HEAD)" > "$work/manifest.txt"
cp docker-compose.yml "$work/compose.yml"
(cd "$work" && sha256sum database.dump files.tar compose.yml > SHA256SUMS)
archive="$BACKUP_DIR/tuinwerk-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.age"
tar -C "$work" -cf - . | age -r "$AGE_RECIPIENT" -o "$archive.partial"
mv "$archive.partial" "$archive"
docker compose start api web >/dev/null
paused=0
if [[ -n ${RCLONE_DEST:-} ]]; then rclone copyto "$archive" "${RCLONE_DEST%/}/$(basename "$archive")"; fi
printf '%s\n' "$archive"
