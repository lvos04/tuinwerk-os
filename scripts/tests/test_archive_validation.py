"""A successful preview must represent complete app data, not only a claimed manifest."""
import io
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
VALIDATOR = pathlib.Path(__file__).resolve().parents[2] / 'deploy/custom-app/extract-safe.py'
class ArchiveValidation(unittest.TestCase):
    def check_archive(self, directories, files, expected):
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / 'files.tar'
            with tarfile.open(archive, 'w') as tar:
                for name in directories:
                    item = tarfile.TarInfo(name)
                    item.type = tarfile.DIRTYPE
                    tar.addfile(item)
                for name in files:
                    item = tarfile.TarInfo(name)
                    item.size = 4
                    tar.addfile(item, io.BytesIO(b'test'))
            result = subprocess.run(['python3', str(VALIDATOR), 'files-v2', str(archive), '--check'], capture_output=True)
            self.assertEqual(result.returncode == 0, expected, result.stderr.decode())
    def test_all_datasets_and_keys_present(self):
        self.check_archive(['uploads','exports','config'], ['config/settings.key','config/totp.key'], True)
    def test_missing_exports_rejected(self):
        self.check_archive(['uploads','config'], ['config/settings.key','config/totp.key'], False)
    def test_missing_mfa_key_rejected(self):
        self.check_archive(['uploads','exports','config'], ['config/settings.key'], False)
    def test_traversal_rejected(self):
        self.check_archive(['uploads','exports','config'], ['config/settings.key','config/totp.key','uploads/../../escape'], False)
if __name__ == '__main__':
    unittest.main()
