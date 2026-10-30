// Writes the phones' copies of the demo world (site/src/demo-world.js): mobile/src/demo-world.ts and
// ios/OneTop/Model/DemoWorld.swift, with each session's controls worked out as the web demo works them
// out, and ios/OneTopTests/DemoWorldExpected.swift, the numbers the web model gives at one moment, which
// the iPhone's model must give too. node scripts/demo-world.mjs [--check]
import {readFileSync,writeFileSync} from 'node:fs';
import {WORLD} from '../site/src/demo-world.js';
import {machines,accounts,sessionNumbers,capabilities,host} from '../site/src/demo-model.js';

const root=new URL('../',import.meta.url),HEAD='Written by scripts/demo-world.mjs from site/src/demo-world.js. Do not edit by hand.';
/** The moment the expected numbers are taken at, as both the demo's start and now. */
export const CHECK_AT=1800000000;

// Each shown session's controls, as its computer offers them when the demo begins.
const caps=Object.fromEntries(WORLD.sessions.map(([,id,kind,,,status,,weight,app],i)=>[id,capabilities({id,control_key:'demo-'+i,kind,app,status,tokens:weight>0?[1]:null})]));
const world={...WORLD,caps};

const ts=`// ${HEAD}
import type {DemoWorld} from './demo-model';
export const WORLD:DemoWorld=${JSON.stringify(world,null,1)};
`;

const num=n=>{const s=String(n);return s.includes('e')||s.includes('.')?s:s+(Number.isInteger(n)?'':'')};
const str=v=>v===null||v===undefined?'nil':JSON.stringify(v);
const swift=`// ${HEAD}
// swiftlint:disable all
enum DemoWorld {
    struct Computer { let id: String, name: String, platform: String, seed: UInt32, scale: Double, duty: Double, control: Bool, cores: Int, memory: Double, used: Double, cpu: (idle: Double, busy: Double) }
    struct Account { let key: String, id: String, kind: String, email: String, alias: String?, plan: String, per: Double, reset: Double, five: (reset: Double, factor: Double)?, source: String?, stale: Double?, status: String? }
    struct Session { let computer: Int, id: String, kind: String, project: String, model: String?, status: String, account: String?, weight: Double, app: String, title: String, effort: String?, caps: [String] }
    struct Child { let lead: String, name: String, share: Double, status: String }
    struct Earlier { let computer: Int, kind: String, account: String?, model: String?, project: String, weight: Double }
    struct Goal { let runtime: String, status: String, tokensUsed: Double, timeUsedSeconds: Double, sessionConnected: Bool }
    struct Operations { let installedSkills: Int, observedEvents: Int, goals: [Goal] }
    static let rest: UInt32 = ${WORLD.rest}
    static let computers: [Computer] = [
${WORLD.computers.map(c=>`        Computer(id: ${str(c.id)}, name: ${str(c.name)}, platform: ${str(c.platform)}, seed: ${c.seed}, scale: ${num(c.scale)}, duty: ${num(c.duty)}, control: ${c.control}, cores: ${c.cores}, memory: ${num(c.memory)}, used: ${num(c.used)}, cpu: (${num(c.cpu[0])}, ${num(c.cpu[1])})),`).join('\n')}
    ]
    static let accounts: [Account] = [
${WORLD.accounts.map(a=>`        Account(key: ${str(a.key)}, id: ${str(a.id)}, kind: ${str(a.kind)}, email: ${str(a.email)}, alias: ${str(a.alias)}, plan: ${str(a.plan)}, per: ${num(a.per)}, reset: ${num(a.reset)}, five: ${a.five?`(${num(a.five.reset)}, ${num(a.five.factor)})`:'nil'}, source: ${str(a.source)}, stale: ${a.stale?num(a.stale):'nil'}, status: ${str(a.status)}),`).join('\n')}
    ]
    static let sessions: [Session] = [
${WORLD.sessions.map(([c,id,kind,project,model,status,account,weight,app,title,effort])=>`        Session(computer: ${c}, id: ${str(id)}, kind: ${str(kind)}, project: ${str(project)}, model: ${str(model)}, status: ${str(status)}, account: ${str(account)}, weight: ${num(weight)}, app: ${str(app)}, title: ${str(title)}, effort: ${str(effort)}, caps: ${JSON.stringify(caps[id])}),`).join('\n')}
    ]
    static let children: [Child] = [
${WORLD.children.map(([lead,name,share,status])=>`        Child(lead: ${str(lead)}, name: ${str(name)}, share: ${num(share)}, status: ${str(status)}),`).join('\n')}
    ]
    static let earlier: [Earlier] = [
${WORLD.earlier.map(([c,kind,account,model,project,weight])=>`        Earlier(computer: ${c}, kind: ${str(kind)}, account: ${str(account)}, model: ${str(model)}, project: ${str(project)}, weight: ${num(weight)}),`).join('\n')}
    ]
    static let operations: [Operations] = [
${WORLD.operations.map(o=>`        Operations(installedSkills: ${o.installed_skills}, observedEvents: ${o.observed_events}, goals: [${o.goals.map(g=>`Goal(runtime: ${str(g.runtime)}, status: ${str(g.status)}, tokensUsed: ${num(g.tokens_used)}, timeUsedSeconds: ${num(g.time_used_seconds)}, sessionConnected: ${g.session_connected})`).join(', ')}]),`).join('\n')}
    ]
}
`;

// The numbers at CHECK_AT, for the iPhone's test: each session's last hour, last day, rate and total, and
// each account's limits and day, five hours and hour.
const all=machines(CHECK_AT,CHECK_AT),limits=accounts(all,CHECK_AT,CHECK_AT),PERIODS=[['24h',86400],['5h',18000],['1h',3600]];
const sum=v=>v.reduce((a,b)=>a+b,0);
const rows=all.flatMap(m=>m.list.map((s,j)=>[m,s,j]).filter(([,s])=>!s.earlier&&s.weight>0).map(([m,s,j])=>{
 const n=sessionNumbers(m,j,CHECK_AT,CHECK_AT,PERIODS);return `        ("${s.id}", ${sum(n.windows['1h'])}, ${sum(n.windows['24h'])}, ${n.rate}, ${sum(n.tokens)}),`;}));
const limitRows=limits.map(a=>`        ("${a.key}", ${a.weekly}, ${a.five??-1}, ${(a.used(CHECK_AT-86400)*a.per).toFixed(4)}, ${(a.used(CHECK_AT-18000)*a.per).toFixed(4)}, ${(a.used(CHECK_AT-3600)*a.per).toFixed(4)}),`);
const expected=`// ${HEAD}
// The web model's numbers at checkAt (as both the demo's start and now); DemoWorldTests checks the
// iPhone's model gives the same.
enum DemoWorldExpected {
    static let checkAt: Double = ${CHECK_AT}
    /// (session, last hour, last day, rate, total) in tokens.
    static let sessions: [(String, Double, Double, Double, Double)] = [
${rows.join('\n')}
    ]
    /// (computer, CPU %, memory in use in bytes).
    static let hosts: [(String, Double, Double)] = [
${all.map(m=>{const h=host(m,CHECK_AT);return `        ("${m.computer.id}", ${h.cpu}, ${h.used_memory}),`;}).join('\n')}
    ]
    /// (account, weekly %, 5-hour % or -1, day, five hours and hour in percentage points).
    static let accounts: [(String, Double, Double, Double, Double, Double)] = [
${limitRows.join('\n')}
    ]
}
`;

const files=[['mobile/src/demo-world.ts',ts],['ios/OneTop/Model/DemoWorld.swift',swift],['ios/OneTopTests/DemoWorldExpected.swift',expected]];
if(import.meta.url===`file://${process.argv[1]}`){
 const check=process.argv.includes('--check'),stale=[];
 for(const [path,text] of files){const url=new URL(path,root);let old='';try{old=readFileSync(url,'utf8');}catch{}
  if(old!==text){if(check)stale.push(path);else writeFileSync(url,text);}}
 if(check&&stale.length){console.error('Out of date; run node scripts/demo-world.mjs: '+stale.join(', '));process.exit(1);}
 console.log(check?'The phones carry the demo world.':'Wrote '+files.map(f=>f[0]).join(', '));
}
export {files};
