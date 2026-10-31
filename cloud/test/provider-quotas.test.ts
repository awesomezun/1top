import {expect, it} from 'vitest';
import {snapshot} from '../src/protocol';

it('retains independent provider pools and actual allowance periods without credentials',()=>{
 const clean=snapshot({sessions:[],account_quotas:[{
  id:'antigravity:abc',kind:'Antigravity',account_label:'PRIVATE EMAIL',alias:'Gemini 4 Argon',
  provider:'Google Antigravity',pool:'Gemini 4 Argon',identity_source:'cli_profile',identity_verified:false,
  token:'PRIVATE TOKEN',windows:[{key:'gemini-argon-wtu-weekly',period:'weekly',label:'주간',pct:75.5,
   reset:1900000000,seconds:604800,secret:'PRIVATE TOKEN'}]
 },{
  id:'glm:def',kind:'GLM',provider:'Z.ai',identity_source:'credential_fingerprint',
  windows:[{key:'token-5h',period:'5h',label:'5H',pct:100,reset:1900000000,seconds:18000,scope:'models',meter:'TOKENS_LIMIT'},
   {key:'mcp-month',period:'monthly',label:'MCP · 월간',pct:44,reset:1900000000,scope:'mcp',meter:'TIME_LIMIT'}]
 }]});
 expect(clean.account_quotas[0].pool).toBe('Gemini 4 Argon');
 expect(clean.account_quotas[0].identity_verified).toBe(false);
 expect(clean.account_quotas[0].windows[0].seconds).toBe(604800);
 expect(clean.account_quotas[1].windows.map(w=>w.period)).toEqual(['5h','monthly']);
 expect(clean.account_quotas[1].windows[1].scope).toBe('mcp');
 expect(JSON.stringify(clean)).not.toContain('PRIVATE');
});

it('bounds and validates additional provider metadata and invalid windows',()=>{
 const q=snapshot({sessions:[],account_quotas:[{id:'a',kind:'GLM',provider:'x'.repeat(100),pool:'y'.repeat(200),
  identity_source:'untrusted',identity_verified:'yes',status:'no_quota',windows:[null,
   {label:'5H',period:'invented',pct:Infinity,reset:-2,seconds:NaN,scope:'secret'},
   ...Array.from({length:20},()=>({label:'5H',pct:0,period:'5h',reset:0}))]}]}).account_quotas[0];
 expect(q.provider?.length).toBe(40);expect(q.pool?.length).toBe(80);
 expect(q.identity_source).toBe('');expect(q.identity_verified).toBeNull();
 expect(q.status).toBe('no_quota');expect(q.windows.length).toBeLessThanOrEqual(16);
 expect(q.windows[0]).toMatchObject({pct:null,reset:0,period:'',seconds:null,scope:''});
 expect(q.windows[1].pct).toBe(0);
});
