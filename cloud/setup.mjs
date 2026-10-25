#!/usr/bin/env node
// Deploy an isolated relay into the user's own Cloudflare account.
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const args=process.argv.slice(2),owner=args[args.indexOf('--owner')+1];
if(!args.includes('--owner')||!owner||!/^[A-Za-z0-9_-]{1,128}$/.test(owner))throw Error('Usage: npm run setup -- --owner YOUR_GOOGLE_USER_ID (shown in 1top Settings)');
const suffix=createHash('sha256').update(owner).digest('hex').slice(0,10),name='onetop-'+suffix;
const configPath=root+'.selfhost/'+name+'.json';
await mkdir(root+'.selfhost',{recursive:true});
const config={name,main:'../src/index.ts',compatibility_date:'2026-08-22',durable_objects:{bindings:[{name:'HUBS',class_name:'AccountHub'}]},migrations:[{tag:'v1',new_sqlite_classes:['AccountHub']}],vars:{DEPLOYMENT_MODE:'self_hosted',OWNER_USER_ID:owner,FIREBASE_PROJECT_ID:'onetop-si',WEB_URL:'https://1top.si',WEB_ORIGINS:'https://1top.si',PAIRING_ENABLED:'true',BILLING_ENABLED:'false'},triggers:{crons:['17 * * * *']}};
try{await access(configPath);}catch{await writeFile(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx'});}
const run=(...command)=>{const r=spawnSync(process.execPath,[root+'node_modules/wrangler/bin/wrangler.js',...command,'--config',configPath],{stdio:'inherit',cwd:root});if(r.status!==0)process.exit(r.status||1);};
console.log('This relay and its Cloudflare usage belong to the account you select. No 1top managed subscription is required.');
if(!JSON.parse(await readFile(configPath,'utf8')).d1_databases?.length)run('d1','create',name+'-state','--binding','DB','--update-config');
run('d1','execute','DB','--remote','--file',root+'schema.sql');
run('deploy');
console.log('Copy the printed https://...workers.dev address into 1top → Settings → Your own relay. Use the same address when connecting the desktop app.');
