import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import psutil

from onetop import accounts, provider_quotas
from onetop.discovery import cli_kind


def process(name, exe='', args=(), env=None):
    result = Mock()
    result.info = {'name': name, 'exe': exe, 'cmdline': list(args)}
    result.environ.return_value = env or {}
    return result


class CliAccountDiscoveryTests(unittest.TestCase):
    def test_versioned_native_claude_requires_an_installation_path(self):
        for exe in ['/home/user/.local/share/claude/versions/2.1.314',
                    r'C:\Users\user\.local\share\claude\versions\2.1.314.exe']:
            self.assertEqual(cli_kind('2.1.314', [], exe), 'Claude')
        for exe in ['', '/tmp/2.1.314', '/apps/claude/versions/2.1.314/helper',
                    '/apps/not-claude/versions/2.1.314']:
            self.assertIsNone(cli_kind('2.1.314', [], exe))
        self.assertIsNone(cli_kind('node', ['node', 'index.js',
            '/home/user/.local/share/claude/versions/2.1.314']))

    def test_profiles_from_native_and_npm_clis_are_discovered(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            native = process('2.1.314', '/home/user/.local/share/claude/versions/2.1.314',
                             env={'CLAUDE_CONFIG_DIR': str(home / 'custom-claude')})
            npm = process('node', args=['node', '/lib/node_modules/@openai/codex/bin/codex.js'],
                          env={'CODEX_HOME': str(home / 'custom-codex')})
            unrelated = process('node', args=['node', '/app/server.js'],
                                env={'CLAUDE_CONFIG_DIR': str(home / 'unrelated')})
            denied = process('claude'); denied.environ.side_effect = psutil.AccessDenied(123)
            with patch.dict(accounts.os.environ, {}, clear=True), \
                    patch.object(accounts.psutil, 'process_iter', return_value=[native, npm, unrelated, denied]):
                roots = accounts.profile_roots(home)
            self.assertIn(('Claude', home / 'custom-claude'), roots)
            self.assertIn(('Codex', home / 'custom-codex'), roots)
            self.assertNotIn(('Claude', home / 'unrelated'), roots)
            unrelated.environ.assert_not_called()

    def test_glm_runtime_key_survives_native_claude_process_naming(self):
        env = {'ANTHROPIC_BASE_URL': 'https://api.z.ai/api/anthropic',
               'ANTHROPIC_AUTH_TOKEN': 'TEST-NATIVE-KEY'}
        native = process('2.1.314', '/home/user/.local/share/claude/versions/2.1.314', env=env)
        npm = process('node', args=['node', '/lib/node_modules/@anthropic-ai/claude-code/cli.js'], env=env)
        unrelated = process('node', args=['node', '/app/server.js'],
                            env={**env, 'ANTHROPIC_AUTH_TOKEN': 'UNRELATED-KEY'})
        with tempfile.TemporaryDirectory() as directory, \
                patch.dict(provider_quotas.os.environ, {}, clear=True), \
                patch.object(provider_quotas.psutil, 'process_iter', return_value=[native, npm, unrelated]), \
                patch.object(provider_quotas, 'executable', return_value=None):
            sources = provider_quotas.discover(Path(directory))
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].id, provider_quotas.glm_source(env).id)
        self.assertNotIn('TEST-NATIVE-KEY', repr(sources))
        native.environ.assert_called_once()
        unrelated.environ.assert_not_called()


if __name__ == '__main__':
    unittest.main()
