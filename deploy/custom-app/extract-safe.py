"""Validate our backup format before extraction; forbid links, special files and traversal."""
import pathlib
import sys
import tarfile
kind, source, destination = sys.argv[1:4]
with tarfile.open(source, 'r:') as archive:
    members = archive.getmembers()
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe archive member')
        parts = [part for part in path.parts if part != '.']
        if not parts:
            continue
        if kind == 'outer':
            if len(parts) != 1 or parts[0] not in {'database.dump', 'files.tar', 'manifest.txt', 'manifest.json', 'SHA256SUMS'}:
                raise SystemExit('Unknown backup member')
        elif parts[0] not in {'uploads', 'exports', 'config'}:
            raise SystemExit('Unexpected data directory')
    if kind == 'files-v2':
        names = {str(pathlib.PurePosixPath(member.name)) for member in members if member.isfile()}
        directories = {str(pathlib.PurePosixPath(member.name)) for member in members if member.isdir()}
        if not {'uploads', 'exports', 'config'}.issubset(directories):
            raise SystemExit('Backup is missing a required data directory')
        if not {'config/settings.key', 'config/totp.key'}.issubset(names):
            raise SystemExit('Backup is missing protected settings or authentication keys')
    if destination != '--check':
        # All entries are validated regular files/directories in an operator-owned target.
        archive.extractall(destination, members=members)
