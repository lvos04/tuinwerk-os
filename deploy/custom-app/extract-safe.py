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
            if len(parts) != 1 or parts[0] not in {'database.dump', 'files.tar', 'manifest.txt', 'SHA256SUMS'}:
                raise SystemExit('Unknown backup member')
        elif parts[0] not in {'uploads', 'exports'}:
            raise SystemExit('Unexpected data directory')
    if destination != '--check':
        # All entries are validated regular files/directories in an operator-owned target.
        archive.extractall(destination, members=members)
