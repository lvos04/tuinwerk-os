import importlib.util
from pathlib import Path
import tempfile
import subprocess
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'deploy/custom-app/retention.py'
spec = importlib.util.spec_from_file_location('retention', MODULE)
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)

class RetentionTests(unittest.TestCase):
    def test_slots_keep_monthly_and_latest_daily(self):
        names = ['tuinwerk-20260101T120000Z-1.tar.age', 'tuinwerk-20260102T120000Z-1.tar.age', 'tuinwerk-20260201T120000Z-1.tar.age', 'tuinwerk-20260202T120000Z-1.tar.age']
        keep, remove = retention.choose(names, daily=1, monthly=2)
        self.assertEqual(set(keep), {names[1], names[3]})
        self.assertEqual(set(remove), {names[0], names[2]})
    def test_dry_run_and_apply_preserve_unknown_and_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old = root / 'tuinwerk-20260201T120000Z-1.tar.age'
            new = root / 'tuinwerk-20260202T120000Z-1.tar.age'
            unknown = root / 'important.tar.age'
            for file in [old, new, unknown]: file.write_text('fixture')
            link = root / 'tuinwerk-20250101T120000Z-1.tar.age'
            link.symlink_to(unknown)
            cmd = ['python3', str(MODULE), tmp, '--daily', '1', '--monthly', '1']
            subprocess.run(cmd, check=True, capture_output=True)
            self.assertTrue(old.exists())
            subprocess.run(cmd + ['--apply'], check=True, capture_output=True)
            self.assertFalse(old.exists())
            self.assertTrue(new.exists())
            self.assertTrue(unknown.exists())
            self.assertTrue(link.is_symlink())
    def test_never_accept_zero_restore_points(self):
        with self.assertRaises(ValueError): retention.choose([], daily=0)
    def test_invalid_dates_ignored(self):
        self.assertEqual(retention.choose(['tuinwerk-20261301T120000Z-1.tar.age']), ([], []))

if __name__ == '__main__': unittest.main()
