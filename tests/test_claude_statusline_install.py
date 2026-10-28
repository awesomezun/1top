"""Installer tests use temporary profiles only; never touch real Claude settings."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import stat
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'install-claude-statusline.py'
SPEC = importlib.util.spec_from_file_location('claude_statusline_install', SCRIPT)
install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install)


class ClaudeStatuslineInstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.data = self.root / 'data'
        self.environment = patch.dict(os.environ, {'ONETOP_DATA': str(self.data)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.profile = self.root / 'Claude profile'
        self.profile.mkdir()
        self.settings = self.profile / 'settings.json'
        self.agent = self.root / "agent 'quoted' executable"
        self.agent.write_text('#!/bin/sh\nexit 0\n')
        self.agent.chmod(0o700)
        self.version = 'v3.16.0'

    def prepare(self, version=None, restore=False, profile=None):
        return install.prepare(str(profile or self.profile), str(self.agent), version or self.version, restore)

    def apply(self, version=None):
        plan = self.prepare(version)
        install.apply_plan(plan)
        return plan

    def write_settings(self, value):
        self.settings.write_bytes(install.encoded(value))

    def test_dry_run_is_default_and_creates_nothing(self):
        original = b'{ "theme": "dark" }\n'
        self.settings.write_bytes(original)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = install.main(['--agent', str(self.agent), '--profile', str(self.profile), '--version', self.version])
        self.assertEqual(result, 0)
        self.assertFalse(json.loads(output.getvalue())['applied'])
        self.assertEqual(self.settings.read_bytes(), original)
        self.assertFalse(self.data.exists())

    def test_preserves_command_options_keys_and_exact_backup_with_private_permissions(self):
        command = 'node "/tmp/my status.js" --label \'a b\'; printf "$HOME"'
        source = {'theme': 'dark', 'env': {'EXAMPLE': 'unchanged'}, 'statusLine': {'type': 'command', 'command': command, 'padding': 2, 'futureOption': True}}
        original = json.dumps(source, ensure_ascii=False, separators=(',', ':')).encode()
        self.settings.write_bytes(original)
        plan = self.apply()
        after = json.loads(self.settings.read_bytes())
        self.assertEqual(after['env'], source['env'])
        self.assertEqual(after['theme'], source['theme'])
        self.assertEqual(after['statusLine']['padding'], 2)
        self.assertTrue(after['statusLine']['futureOption'])
        self.assertNotIn('refreshInterval', after['statusLine'])
        self.assertEqual(shlex.split(after['statusLine']['command']), [str(self.agent), 'statusline', '--config', str(plan['folder'] / 'spec.json')])
        self.assertEqual((plan['folder'] / 'settings.before.json').read_bytes(), original)
        self.assertEqual(json.loads((plan['folder'] / 'spec.json').read_bytes()), {'profile': str(self.profile), 'original_command': command, 'report_directory': str(self.data / 'claude-statusline')})
        for path in [self.settings, *plan['folder'].iterdir()]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(plan['folder'].stat().st_mode), 0o700)

    def test_empty_profile_can_be_restored_without_leaving_settings(self):
        plan = self.apply()
        metadata = json.loads((plan['folder'] / 'backup.json').read_bytes())
        self.assertFalse(metadata['settings_existed'])
        self.assertFalse((plan['folder'] / 'settings.before.json').exists())
        self.assertEqual(json.loads((plan['folder'] / 'spec.json').read_bytes())['original_command'], '')
        self.assertTrue(install.apply_plan(self.prepare(restore=True)))
        self.assertFalse(self.settings.exists())
        self.assertFalse(install.apply_plan(self.prepare(restore=True)))

    def test_repeated_apply_does_not_rewrite_settings_or_backups(self):
        self.write_settings({'statusLine': {'command': 'printf original', 'padding': 1}})
        plan = self.apply()
        snapshots = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in [self.settings, *plan['folder'].iterdir()]}
        self.assertFalse(install.apply_plan(self.prepare()))
        self.assertEqual(snapshots, {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in snapshots})

    def test_upgrade_unwraps_original_and_restore_reinstates_previous_version(self):
        self.write_settings({'statusLine': {'command': 'printf original', 'padding': 1}})
        first = self.apply()
        first_settings = self.settings.read_bytes()
        first_spec = (first['folder'] / 'spec.json').read_bytes()
        second = self.apply('v3.16.1')
        self.assertEqual(json.loads((second['folder'] / 'spec.json').read_bytes())['original_command'], 'printf original')
        self.assertEqual((first['folder'] / 'spec.json').read_bytes(), first_spec)
        install.apply_plan(self.prepare('v3.16.1', restore=True))
        self.assertEqual(self.settings.read_bytes(), first_settings)

    def test_restore_preserves_unrelated_later_changes(self):
        original_statusline = {'command': 'printf original', 'padding': 3}
        self.write_settings({'statusLine': original_statusline, 'theme': 'dark'})
        self.apply()
        after = json.loads(self.settings.read_bytes())
        after['theme'] = 'light'
        after['newKey'] = [1, 2]
        self.write_settings(after)
        install.apply_plan(self.prepare(restore=True))
        self.assertEqual(json.loads(self.settings.read_bytes()), {'statusLine': original_statusline, 'theme': 'light', 'newKey': [1, 2]})

    def test_restore_exact_original_bytes_when_settings_unchanged(self):
        original = b'{"theme":"dark", "statusLine":{"command":"echo old"}}\n\n'
        self.settings.write_bytes(original)
        self.apply()
        install.apply_plan(self.prepare(restore=True))
        self.assertEqual(self.settings.read_bytes(), original)

    def test_refuses_symlink_profile_and_settings(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaises(install.InstallError):
            self.prepare(profile=alias)
        outside = self.root / 'outside.json'
        outside.write_text('{}')
        self.settings.symlink_to(outside)
        with self.assertRaises(install.InstallError):
            self.prepare()
        self.assertEqual(outside.read_text(), '{}')
        self.assertFalse(self.data.exists())

    def test_refuses_symlink_integration_directory(self):
        self.data.mkdir()
        outside = self.root / 'outside'
        outside.mkdir()
        (self.data / 'integrations').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(install.InstallError):
            self.prepare()
        self.assertEqual(list(outside.iterdir()), [])

    def test_never_reads_arbitrary_spec_path_from_existing_command(self):
        outside = self.root / 'do-not-read.json'
        outside.write_text('not json')
        command = shlex.join([str(self.agent), 'statusline', '--config', str(outside)])
        self.write_settings({'statusLine': {'command': command}})
        with patch.object(install, 'read_file', wraps=install.read_file) as reader:
            plan = self.prepare()
        self.assertNotIn(outside, [Path(call.args[0]) for call in reader.call_args_list])
        self.assertEqual(plan['spec']['original_command'], command)

    def test_wrong_profile_spec_is_refused(self):
        plan = self.apply()
        (plan['folder'] / 'spec.json').write_bytes(install.encoded({'profile': '/somewhere/else', 'original_command': ''}))
        settings_before = self.settings.read_bytes()
        with self.assertRaises(install.InstallError):
            self.prepare()
        self.assertEqual(self.settings.read_bytes(), settings_before)

    def test_invalid_json_and_multi_profile_preflight_leave_all_profiles_untouched(self):
        self.write_settings({'theme': 'dark'})
        before = self.settings.read_bytes()
        other = self.root / 'bad-profile'
        other.mkdir()
        (other / 'settings.json').write_text('{broken')
        with contextlib.redirect_stderr(io.StringIO()):
            result = install.main(['--agent', str(self.agent), '--profile', str(self.profile), '--profile', str(other), '--version', self.version, '--apply'])
        self.assertEqual(result, 1)
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertFalse(self.data.exists())

    def test_changes_after_preflight_are_not_overwritten(self):
        self.write_settings({'theme': 'dark'})
        plan = self.prepare()
        self.write_settings({'theme': 'changed elsewhere'})
        with self.assertRaises(install.InstallError):
            install.apply_plan(plan)
        self.assertEqual(json.loads(self.settings.read_bytes())['theme'], 'changed elsewhere')
        self.assertFalse(self.data.exists())

    def test_same_version_conflict_cannot_replace_backup(self):
        self.write_settings({'statusLine': {'command': 'printf original'}})
        plan = self.apply()
        backup = (plan['folder'] / 'settings.before.json').read_bytes()
        self.write_settings({'statusLine': {'command': 'printf replacement'}})
        with self.assertRaises(install.InstallError):
            self.prepare()
        self.assertEqual((plan['folder'] / 'settings.before.json').read_bytes(), backup)


if __name__ == '__main__':
    unittest.main()
