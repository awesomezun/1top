import unittest
from onetop.context_usage import request_context,stored_context
from onetop.server import Ledger
from onetop.bridge import export_snapshot

class ContextTests(unittest.TestCase):
    def test_claude_adds_input_and_cache_but_excludes_output(self):
        c=request_context({'input_tokens':10,'cache_read_input_tokens':20,'cache_creation_input_tokens':3,'output_tokens':900},100)
        self.assertEqual(c['input_tokens'],33);self.assertIsNone(c['capacity'])
        self.assertEqual(c['parts'],[10,20,3])
    def test_codex_cache_is_part_of_input(self):
        c=request_context({'input_tokens':100,'cached_input_tokens':80,'output_tokens':900},100,capacity=1000,codex=True)
        self.assertEqual(c['input_tokens'],100);self.assertEqual(c['parts'],[20,80,0])
    def test_missing_negative_and_nonfinite_are_unknown_not_zero(self):
        for value in [None,-1,float('nan'),float('inf'),True,'20']:
            self.assertIsNone(request_context({'input_tokens':value},100))
        self.assertEqual(request_context({'input_tokens':0},100)['input_tokens'],0)
        self.assertIsNone(request_context({'input_tokens':10,'cached_input_tokens':20},100,codex=True))
    def test_old_ledger_uses_input_never_lifetime_tokens_or_model_guess(self):
        self.assertIsNone(stored_context({'total':[99999,99999,99999,99999],'model':'claude-sonnet-4-6[1m]'}))
        c=stored_context({'request_input':123,'last_usage':10,'model':'test'})
        self.assertEqual(c['input_tokens'],123);self.assertIsNone(c['capacity']);self.assertIsNone(c['parts'])
    def test_late_older_message_does_not_replace_context(self):
        def event(mid,t,n):return {'type':'assistant','timestamp':t,'message':{'id':mid,'model':'test','usage':{'input_tokens':n}}}
        l=Ledger('Claude');l.consume(event('new',200,30));l.consume(event('old',100,50))
        self.assertEqual(l.s['context_usage']['input_tokens'],30)
        l.consume(event('new',200,5));self.assertEqual(l.s['context_usage']['input_tokens'],30)
        l.consume(event('next',300,10));self.assertEqual(l.s['context_usage']['input_tokens'],10)
    def test_codex_context_survives_without_cumulative_counter(self):
        l=Ledger('Codex');l.consume({'type':'event_msg','timestamp':100,'payload':{'type':'token_count','info':{'last_token_usage':{'input_tokens':20},'model_context_window':100}}})
        self.assertEqual(l.s['context_usage']['input_tokens'],20)
        l.consume({'type':'turn_context','timestamp':101,'payload':{'model':'new'}})
        self.assertIsNone(stored_context(l.s))
    def test_export_context_only_allows_numeric_summary_fields(self):
        c=request_context({'input_tokens':20},100);c['prompt']='PRIVATE';c['files']=['PRIVATE']
        row=export_snapshot({'sessions':[{'id':'one','kind':'Claude','context_usage':c}]})['sessions'][0]
        self.assertNotIn('prompt',row['context_usage']);self.assertNotIn('files',row['context_usage'])
