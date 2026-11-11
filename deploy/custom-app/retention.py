"""Select daily/monthly encrypted restore points; dry-run unless --apply is explicit."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re

PATTERN = re.compile(r'^tuinwerk-(\d{8}T\d{6}Z)-(\d+)\.tar\.age$')

def choose(files, daily=30, monthly=12):
    if not 1 <= daily <= 10000 or not 1 <= monthly <= 1200:
        raise ValueError('Keep at least one daily and monthly restore point')
    parsed = []
    for name in files:
        match = PATTERN.fullmatch(name)
        if not match:
            continue
        try:
            stamp = dt.datetime.strptime(match[1], '%Y%m%dT%H%M%SZ')
        except ValueError:
            continue
        parsed.append((stamp, name))
    parsed.sort(reverse=True)
    days, months, keep = set(), set(), set()
    for stamp, name in parsed:
        day, month = stamp.date(), (stamp.year, stamp.month)
        selected = False
        if day not in days and len(days) < daily:
            days.add(day)
            selected = True
        if month not in months and len(months) < monthly:
            months.add(month)
            selected = True
        if selected:
            keep.add(name)
    return sorted(keep), sorted(name for _, name in parsed if name not in keep)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--daily', type=int, default=30)
    parser.add_argument('--monthly', type=int, default=12)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    files = [p.name for p in args.directory.iterdir() if p.is_file() and not p.is_symlink()]
    keep, remove = choose(files, args.daily, args.monthly)
    if args.apply:
        for name in remove:
            path = args.directory / name
            if path.is_file() and not path.is_symlink():
                path.unlink()
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', 'keep': keep, 'remove': remove}))

if __name__ == '__main__':
    main()
