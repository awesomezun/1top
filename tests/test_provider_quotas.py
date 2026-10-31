import copy
import json
import sqlite3
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from onetop import provider_quotas as p
from onetop.accounts import AccountQuotaSampler
from onetop.account_aliases import apply
from onetop.bridge import export_snapshot
from onetop import weekly_usage


def envelope(groups):
    return {'status': 'SUCCESS', 'conversation_id': '', 'num_turns': 0,
            'usage': {'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0},
            'command': {'name': 'usage', 'data': {'groups': groups}}}


def group(name='Gemini Models', fraction=.25, period='weekly', **kw):
    return {'name': name, 'buckets': [dict(id=name+'-'+period, window=period,
        remaining_fraction=fraction, reset_time='2030-01-01T00:00:00Z', **kw)]}


def glm(limits):
    return {'success': True, 'code': 200, 'data': {'limits': limits}}


class ProviderParserTests(unittest.TestCase):
    def test_agy_keeps_independent_pools_and_true_zero(self):
        rows=p.agy_rows(envelope([group(fraction=1),group('Claude and GPT models',.8),group('Gemini 4 Argon',.245)]),'profile',100)
        self.assertEqual(len({r['id'] for r in rows}),3)
        self.assertEqual([r['windows'][0]['pct'] for r in rows],[0,19.999999999999996,75.5])
        self.assertTrue(all(r['identity_verified'] is False for r in rows))
        self.assertEqual([r['pool'] for r in rows],['Gemini Models','Claude and GPT models','Gemini 4 Argon'])
        self.assertEqual(rows[0]['windows'][0]['period'],'weekly')

    def test_agy_unknown_invalid_expired_disabled_and_zero_are_distinct(self):
        data=envelope([group(fraction=None),group('invalid',float('nan')),group('bad-range',1.1),group('disabled',.2,disabled=True)])
        rows=p.agy_rows(data,'profile',100)
        self.assertEqual(len(rows),3)
        self.assertTrue(all(r['windows'][0]['pct'] is None for r in rows))
        rows=p.agy_rows(envelope([group()]),'profile',2000000000)
        self.assertIsNone(rows[0]['windows'][0]['pct'])
        self.assertEqual(p.agy_rows(envelope([group(period='unexpected')]),'profile',100)[0]['windows'][0]['label'],'unknown')

    def test_agy_rejects_model_turns_and_non_usage_commands(self):
        for change in [{'num_turns':1},{'num_turns':False},{'conversation_id':'session'}, {'usage':{'total_tokens':2}},
                       {'command':{'name':'model'}}, {'status':'ERROR'}]:
            with self.subTest(change=change),self.assertRaises(p.ProviderError):
                p.agy_rows({**envelope([group()]),**change},'profile',100)

    def test_glm_legacy_five_hours_and_calendar_month_are_not_weekly(self):
        windows=p.glm_windows(glm([
            {'type':'TIME_LIMIT','unit':5,'number':1,'percentage':44,'usage':100,'currentValue':44},
            {'type':'TOKENS_LIMIT','unit':3,'number':5,'percentage':100}]),100)
        self.assertEqual([w['period'] for w in windows],['5h','monthly'])
        self.assertEqual(windows[1]['label'],'MCP · 월간')
        self.assertEqual([w['pct'] for w in windows],[100,44])
        self.assertNotIn('주간',[w['label'] for w in windows])

    def test_glm_weekly_credits_use_exact_ratio_not_rounded_percentage(self):
        windows=p.glm_windows(glm([{'type':'CREDIT_LIMIT','unit':6,'number':1,'usage':10000,
                                  'currentValue':12.5,'percentage':0,'nextResetTime':1900000000000}]),100)
        self.assertEqual(windows[0]['pct'],.125)
        self.assertEqual(windows[0]['label'],'주간')
        self.assertEqual(windows[0]['reset'],1900000000)
        windows=p.glm_windows(glm([{'type':'CREDIT_LIMIT','unit':6,'number':1,'usage':100,
                                  'remaining':57.5}]),100)
        self.assertEqual(windows[0]['pct'],42.5)

    def test_glm_unknown_zero_expired_and_error_envelope(self):
        windows=p.glm_windows(glm([{'type':'TOKENS_LIMIT','unit':3,'number':5,'percentage':value}
                                  for value in [0,None,True,float('nan'),float('inf'),-1]]),100)
        self.assertEqual([w['pct'] for w in windows],[0,None,None,None,None,None])
        self.assertIsNone(p.glm_windows(glm([{'type':'TOKENS_LIMIT','percentage':99,'nextResetTime':99}]),100)[0]['pct'])
        for data in [{}, {'success':False,'code':200,'data':{}}, {'success':True,'code':401,'data':{'limits':[]}}]:
            with self.assertRaises(p.ProviderError):p.glm_windows(data,100)


class ProviderConnectionTests(unittest.TestCase):
    def source(self,key='TEST-KEY',host='api.z.ai'):
        return p.glm_source({'ANTHROPIC_BASE_URL':'https://'+host+'/api/anthropic','ANTHROPIC_AUTH_TOKEN':key})

    def test_allowlist_and_secret_free_identity(self):
        source=self.source()
        self.assertNotIn('TEST-KEY',source.id+repr(source))
        self.assertEqual(source.id,self.source('Bearer TEST-KEY').id)
        self.assertNotEqual(source.id,self.source(host='open.bigmodel.cn').id)
        self.assertEqual(source.id,p.glm_source({'ZAI_API_KEY':'TEST-KEY'}).id)
        for url in ['https://api.z.ai.evil.test','http://api.z.ai','https://user@api.z.ai','https://api.z.ai:444','https://api.z.ai:bad']:
            self.assertIsNone(p.glm_source({'ANTHROPIC_BASE_URL':url,'ANTHROPIC_AUTH_TOKEN':'TEST-KEY'}))
        self.assertIsNone(self.source('TEST\nKEY'))

    def test_installation_scope_is_stable_but_never_shared_between_computers(self):
        with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
            with patch.object(p,'data_directory',side_effect=lambda home:home/'state'):
                one=p.installation_scope(Path(a));two=p.installation_scope(Path(b))
                self.assertEqual(one,p.installation_scope(Path(a)))
                self.assertNotEqual(one,two)
                saved=Path(a)/'state/provider-profile-v1.json'
                self.assertEqual(json.loads(saved.read_text()),{'id':one})
                self.assertEqual(saved.stat().st_mode & 0o777,0o600)

    def test_read_only_request_no_redirect_and_bounded_response(self):
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.read.return_value=b'{"success":true,"data":{"limits":[]}}'
        opener=Mock();opener.open.return_value=response
        with patch.object(p.urllib.request,'build_opener',return_value=opener):
            p.glm_query('api.z.ai','TEST-KEY')
        req=opener.open.call_args.args[0]
        self.assertEqual(req.full_url,'https://api.z.ai/api/monitor/usage/quota/limit')
        self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
        self.assertEqual(req.get_header('Authorization'),'TEST-KEY')
        response.read.assert_called_once_with(p.MAX_BYTES+1)
        self.assertIsNone(p.NoRedirect().redirect_request(None,None,None,None,None,None))
        with self.assertRaises(p.ProviderError):p.glm_query('attacker.test','TEST-KEY')

    def test_discovery_deduplicates_same_key_from_settings_and_process(self):
        with tempfile.TemporaryDirectory() as d:
            home=Path(d);root=home/'.claude';root.mkdir()
            env={'ANTHROPIC_BASE_URL':'https://api.z.ai/api/anthropic','ANTHROPIC_AUTH_TOKEN':'TEST-KEY'}
            (root/'settings.json').write_text(json.dumps({'env':env}))
            proc=Mock();proc.info={'name':'claude'};proc.environ.return_value=env
            ignored=Mock();ignored.info={'name':'unrelated'}
            with patch.dict(p.os.environ,{},clear=True),patch.object(p.psutil,'process_iter',return_value=[proc,ignored]),patch.object(p,'executable',return_value=None):
                sources=p.discover(home)
            self.assertEqual(len(sources),1);ignored.environ.assert_not_called()

    def test_failure_preserves_last_good_value_but_marks_stale(self):
        sampler=p.ProviderQuotaSampler();source=self.source()
        with patch.object(p,'glm_query',return_value=glm([{'type':'TOKENS_LIMIT','unit':3,'number':5,'percentage':42}])):
            rows=sampler.query(source,100)
        sampler.cached[source.id]=rows
        with patch.object(p,'glm_query',side_effect=urllib.error.HTTPError('hidden',401,'secret',{},None)):
            stale=sampler.query(source,200)
        self.assertEqual(stale[0]['windows'][0]['pct'],42)
        self.assertEqual(stale[0]['updated'],100);self.assertTrue(stale[0]['stale'])
        self.assertEqual(stale[0]['status'],'login_required')
        self.assertFalse(rows[0]['stale'])
        other=self.source('OTHER-KEY')
        with patch.object(p,'glm_query',side_effect=OSError):unknown=sampler.query(other,200)
        self.assertEqual(unknown[0]['windows'],[])
        self.assertNotIn('secret',json.dumps(stale))

    def test_unsafe_cli_response_disables_repeated_invocations(self):
        sampler=p.ProviderQuotaSampler();source=p.Source('Antigravity','a',cli='/agy')
        with patch.object(p,'agy_query',side_effect=p.ProviderError('unsafe_cli_response')) as query:
            sampler.query(source,100);sampler.query(source,200)
        self.assertEqual(query.call_count,1)

    def test_rate_limit_waits_for_retry_after_without_new_requests(self):
        sampler=p.ProviderQuotaSampler();source=self.source()
        error=urllib.error.HTTPError('hidden',429,'hidden',{'Retry-After':'600'},None)
        with patch.object(p,'glm_query',side_effect=error) as query:
            self.assertEqual(sampler.query(source,100)[0]['status'],'rate_limited')
            self.assertEqual(sampler.query(source,300)[0]['status'],'rate_limited')
            self.assertEqual(query.call_count,1)
        self.assertEqual(sampler.retry_after[source.id][0],700)

    def test_rate_limit_honors_http_date_and_recovers_after_deadline(self):
        sampler=p.ProviderQuotaSampler();source=self.source();now=1800000000
        header=format_datetime(datetime.fromtimestamp(now+600,timezone.utc),usegmt=True)
        error=urllib.error.HTTPError('hidden',429,'hidden',{'Retry-After':header},None)
        response=glm([{'type':'TOKENS_LIMIT','unit':3,'number':5,'percentage':42}])
        with patch.object(p,'glm_query',side_effect=[error,response]) as query:
            self.assertEqual(sampler.query(source,now)[0]['status'],'rate_limited')
            self.assertEqual(sampler.query(source,now+400)[0]['status'],'rate_limited')
            self.assertEqual(query.call_count,1)
            self.assertEqual(sampler.query(source,now+600)[0]['windows'][0]['pct'],42)
        self.assertNotIn(source.id,sampler.retry_after)

    def test_invalid_retry_after_uses_bounded_default(self):
        for header in ['bad-date','NaN','Infinity']:
            sampler=p.ProviderQuotaSampler();source=self.source()
            error=urllib.error.HTTPError('hidden',429,'hidden',{'Retry-After':header},None)
            with patch.object(p,'glm_query',side_effect=error):sampler.query(source,100)
            self.assertEqual(sampler.retry_after[source.id][0],400)

    def test_closing_cli_retains_key_only_in_memory_for_later_refresh(self):
        sampler=p.ProviderQuotaSampler();source=self.source()
        with patch.object(p,'discover',side_effect=[[source],[]]),patch.object(p,'glm_query',return_value=glm([
            {'type':'TOKENS_LIMIT','unit':3,'number':5,'percentage':42}])) as query:
            sampler.sample();sampler.sample()
        self.assertEqual(query.call_count,2)
        self.assertEqual(len(sampler.rows),1)
        self.assertNotIn('TEST-KEY',json.dumps(sampler.rows))

    def test_agy_invocation_overrides_slash_disable_and_never_passes_a_prompt(self):
        calls=[SimpleNamespace(stdout='1.4.12',returncode=0),SimpleNamespace(stdout=json.dumps(envelope([group()])),returncode=0)]
        with patch.object(p.subprocess,'run',side_effect=calls) as run:
            rows=p.agy_query(p.Source('Antigravity','a',cli='/agy'),100)
        args=run.call_args.args[0]
        self.assertEqual(args[args.index('-p')+1],'/usage')
        self.assertEqual(json.loads(args[args.index('--settings')+1]),{'disableSlashCommands':False})
        self.assertEqual(run.call_args.kwargs['stdin'],p.subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs['env']['AGY_CLI_DISABLE_AUTO_UPDATE'],'true')
        self.assertEqual(len(rows),1)


class ProviderIntegrationTests(unittest.TestCase):
    def test_account_snapshot_merges_without_network_on_read(self):
        sampler=AccountQuotaSampler();rows=p.agy_rows(envelope([group()]),'profile',100)
        sampler.providers.rows=rows
        with patch.object(p,'discover',side_effect=AssertionError('I/O on snapshot')):
            self.assertEqual(sampler.snapshot(100),rows)
        self.assertTrue(sampler.snapshot(500)[0]['stale'])
        sampler.snapshot(500)[0]['windows'].clear()
        self.assertTrue(sampler.providers.rows[0]['windows'])

    def test_pool_name_survives_aliases_and_remote_export_without_credentials(self):
        rows=p.agy_rows(envelope([group()]),'profile',100)
        with tempfile.TemporaryDirectory() as d:apply(rows,Path(d))
        self.assertEqual(rows[0]['alias'],'Gemini Models')
        state={'account_quotas':rows,'sessions':[],'host':{},'applications':[]}
        out=export_snapshot(state)['account_quotas'][0]
        self.assertEqual(out['pool'],'Gemini Models')
        self.assertEqual(out['windows'][0]['period'],'weekly')
        self.assertFalse(out['identity_verified'])

    def test_unverified_cli_profile_cannot_mix_weekly_history_across_accounts(self):
        with sqlite3.connect(':memory:') as db:
            weekly_usage.initialize(db)
            rows=p.agy_rows(envelope([group()]),'profile',100)
            weekly_usage.record(db,rows,100)
            self.assertEqual(db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],0)
            row=copy.deepcopy(rows[0]);row.pop('identity_verified');row.update(kind='GLM')
            weekly_usage.record(db,[row],100)
            self.assertEqual(db.execute('SELECT count(*) FROM weekly_samples').fetchone()[0],1)


if __name__=='__main__':unittest.main()
