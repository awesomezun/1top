import copy
import json
import tempfile
import unittest
from pathlib import Path
from onetop.hierarchy import annotate, codex_metadata, group_sessions


def row(sid, parent=None, value=10, account='a'):
    calibration = {'tokens': 1000, 'used_pp': 1, 'seconds': 600}
    return {'id': sid, 'kind': 'Codex', 'is_subagent': parent is not None,
            'parent_session_id': parent, 'status': 'idle', 'tokens': [value, 0, 0, 0],
            'pids': [1], 'control_key': 'root-key', 'process_started': 'started',
            'input_verified': True, 'orca_terminal': {'handle': 'root-tab', 'title': 'Terminal'},
            'terminal_match': 'confirmed', 'location': {'app': 'Orca', 'match': 'ancestry'},
            'resources': {'cpu': 5, 'rss': 100},
            'usage': {'rate': value, 'output_rate': 0, 'history': [[100, value]],
                      'last_minute': [value, 0, 0, 0], 'last_five_minutes': [value, 0, 0, 0],
                      'windows': {'1h': [value, 0, 0, 0]}, 'weekly_account': account,
                      'weekly_estimate': {'1h': {'basis': 'calibrated_token_equivalent', 'account_id': account,
                                               'used_pp': value/1000, 'tokens': value, 'calibration': calibration}}}}


class HierarchyTests(unittest.TestCase):
    def test_metadata_requires_explicit_subagent_source_not_fork_or_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'session.jsonl'
            def read(payload):
                path.write_text(json.dumps({'type':'session_meta','payload':{'id':'child',**payload}})+'\n')
                return codex_metadata(path, 'child')
            self.assertFalse(read({'source':'cli','forked_from_id':'parent'})['is_subagent'])
            metadata = read({'source':{'subagent':{'thread_spawn':{'parent_thread_id':'parent','depth':2,'agent_path':'/root/task'}}}})
            self.assertEqual(metadata, {'is_subagent':True,'parent_session_id':'parent','agent_depth':2,'agent_path':'/root/task'})
            self.assertEqual(codex_metadata(path, 'wrong'), {})
            self.assertIsNone(read({'parent_thread_id':'different','source':{'subagent':{'thread_spawn':{'parent_thread_id':'parent'}}}})['parent_session_id'])

    def test_nested_children_inherit_verified_location_without_control_or_resource_identity(self):
        root = row('root'); child = row('child', 'root'); grandchild = row('grandchild', 'child')
        specs = annotate([grandchild, child, root])
        for item in specs[:2]:
            self.assertEqual(item['root_session_id'], 'root')
            self.assertEqual(item['orca_terminal']['handle'], 'root-tab')
            self.assertEqual(item['location']['match'], 'parent_session')
            self.assertEqual(item['pids'], [])
            self.assertNotIn('control_key', item)
            self.assertNotIn('process_started', item)
            self.assertFalse(item['input_verified'])
        self.assertEqual(root['child_session_ids'], ['child'])
        self.assertEqual(root['pids'], [1])

    def test_missing_parent_cycle_and_mismatched_provider_are_not_guessed(self):
        a = row('a','b'); b = row('b','a'); missing = row('missing','not-open')
        wrong = row('wrong','root'); root = row('root'); root['kind'] = 'Claude'
        specs = annotate([a,b,missing,wrong,root])
        for s in specs[:4]:
            self.assertIsNone(s['root_session_id'])
            self.assertIsNone(s['orca_terminal'])
            self.assertEqual(s['location']['app'], 'Unknown')
        self.assertEqual(len(group_sessions(specs)), 5)

    def test_distinct_descendants_sum_once_without_mutating_raw_or_summing_resources(self):
        root = row('root',value=10); child = row('child','root',20); grandchild = row('grandchild','child',30)
        child['status'] = 'working'
        specs = annotate([root,child,grandchild]); before = copy.deepcopy(specs)
        groups = group_sessions(specs)
        self.assertEqual(specs, before)
        self.assertEqual(len(groups),1)
        group = groups[0]
        self.assertEqual(group['tokens'],[60,0,0,0])
        self.assertEqual(group['usage']['windows']['1h'],[60,0,0,0])
        self.assertEqual(group['usage']['history'],[[100,60]])
        self.assertEqual(group['usage']['rate'],60)
        self.assertEqual(group['usage']['weekly_estimate']['1h']['used_pp'], .06)
        self.assertEqual(group['children_ids'],['child','grandchild'])
        self.assertEqual(group['children_count'],2)
        self.assertEqual(group['children_working'],1)
        self.assertEqual(group['status'],'idle')
        self.assertEqual(group['control_key'],'root-key')
        self.assertEqual(group['resources'],root['resources'])

    def test_same_project_without_ancestry_stays_separate(self):
        first=row('one');second=row('two');first['project']=second['project']='same'
        self.assertEqual(len(group_sessions(annotate([first,second]))),2)

    def test_missing_or_mixed_account_estimates_are_not_fabricated(self):
        for child in [row('child','root',20,account='b'),row('child','root',20,account=None)]:
            group=group_sessions(annotate([row('root'),child]))[0]
            self.assertIsNone(group['usage']['weekly_account'])
            self.assertEqual(group['usage']['weekly_estimate'],{})
        child=row('child','root');child['tokens']=None;child['usage']['windows']['1h']=None
        group=group_sessions(annotate([row('root'),child]))[0]
        self.assertTrue(group['group_usage_partial'])
        self.assertEqual(group['tokens'],[10,0,0,0])
        self.assertEqual(group['usage']['weekly_estimate'],{})

    def test_zero_child_without_estimate_does_not_block_valid_parent_estimate(self):
        child=row('child','root',0);child['usage']['weekly_estimate']={}
        group=group_sessions(annotate([row('root'),child]))[0]
        self.assertEqual(group['usage']['weekly_estimate']['1h']['tokens'],10)


if __name__ == '__main__':
    unittest.main()
