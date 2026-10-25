import unittest
from onetop.updates import release_info
class ReleaseTests(unittest.TestCase):
 def test_semantic_version_and_fixed_download_destination(self):
  r=release_info({'version':'3.10.0','releases':'https://evil.example','signed':False},'3.9.0')
  self.assertTrue(r['available']);self.assertFalse(r['automatic_install']);self.assertEqual(r['release_url'],'https://github.com/awesomezun/1top/releases/tag/v3.10.0')
  self.assertFalse(release_info({'version':'3.8.0'},'3.9.0')['available'])
 def test_invalid_version_cannot_be_a_url_or_command(self):
  for v in ['latest','1.2','https://evil.example','1.2.3/../other',3]:
   with self.assertRaises(ValueError):release_info({'version':v})
