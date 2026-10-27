import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from onetop.updates import UpdateMonitor
from onetop import windows_runtime as runtime

spec = importlib.util.spec_from_file_location('msix_package', Path(__file__).resolve().parents[1] / 'scripts/prepare-windows-msix.py')
msix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(msix)


class MsixTests(unittest.TestCase):
    def test_store_build_rejects_missing_test_and_placeholder_identities(self):
        for identity in ({}, msix.TEST_IDENTITY, {**msix.TEST_IDENTITY, 'name': 'REPLACE_ME', 'publisher': 'CN=YOUR_PUBLISHER'}):
            with self.assertRaises(ValueError):
                msix.validate_identity(identity, 'store')

    def test_manifest_escapes_publisher_and_has_only_full_trust_capability(self):
        identity = {**msix.TEST_IDENTITY, 'name': 'Publisher.OneTop', 'publisher': 'CN=abc, O=A&B',
                    'publisher_display_name': 'A & B'}
        raw = msix.manifest(msix.validate_identity(identity, 'store'), '3.8.0.0')
        doc = ET.fromstring(raw)
        self.assertEqual(doc.find(f'{{{msix.NS}}}Identity').get('Publisher'), 'CN=abc, O=A&B')
        app = doc.find(f'{{{msix.NS}}}Applications/{{{msix.NS}}}Application')
        self.assertEqual(app.get('Executable'), r'app\1top.exe')
        self.assertEqual(app.get('EntryPoint'), 'Windows.FullTrustApplication')
        caps = doc.find(f'{{{msix.NS}}}Capabilities')
        self.assertEqual([item.get('Name') for item in caps], ['runFullTrust'])

    def test_version_cannot_use_store_reserved_fourth_component(self):
        for version in ('3.8.0', '3.8.0.1', '0.8.0.0', '3.65536.0.0'):
            with self.assertRaises(ValueError):
                msix.manifest(msix.TEST_IDENTITY, version)

    def test_store_update_check_never_offers_external_exe(self):
        with patch.object(runtime, 'package_identity', return_value='Publisher.OneTop_3.8.0.0_x64__fixture'), \
                patch('onetop.updates.urllib.request.build_opener') as opener:
            monitor = UpdateMonitor()
            monitor.check()
            opener.assert_not_called()
            self.assertEqual(monitor.value['channel'], 'microsoft-store')
            self.assertEqual(monitor.value['release_url'], runtime.STORE_UPDATES)
            self.assertFalse(monitor.value['available'])

    def test_activation_fixture_loader_is_unavailable_in_store_build(self):
        with patch.object(runtime, 'package_metadata', return_value={'channel': 'store'}), \
                patch.object(runtime.sys, 'argv', ['1top.exe', '--smoke-config', 'does-not-exist']):
            runtime.configure_test_activation()  # No read or environment modification.

    def test_test_activation_rejects_arbitrary_environment_variables(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'test.json'
            path.write_text(json.dumps({'PATH': 'malicious'}))
            with patch.object(runtime, 'package_metadata', return_value={'channel': 'test'}), \
                    patch.object(runtime.sys, 'argv', ['1top.exe', '--smoke-config', str(path)]):
                with self.assertRaises(ValueError):
                    runtime.configure_test_activation()

    def test_webview_storage_is_writable_unicode_user_data(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'ONETOP_DATA': str(Path(tmp) / '한글 사용자')}):
            storage = runtime.webview_storage()
            (storage / 'probe').write_text('ok')
            self.assertEqual(storage.parent.name, '한글 사용자')
