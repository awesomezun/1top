import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {action,imageAttachments,mailboxRows,snapshot} from '../src/protocol';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXZkAAAAASUVORK5CYII=';
const image={mime:'image/png',data:png};
const request=()=>({action:'message',request_id:crypto.randomUUID(),device_id:crypto.randomUUID(),session_id:'test',control_key:'key',prompt:'Inspect',attachments:[image]});
describe('conversation photos',()=>{
 it('bounds format, decoded size, count and allowed actions',()=>{
  expect(imageAttachments([image])).toEqual([image]);
  for(const images of [[{...image,mime:'text/html'}],[{...image,mime:'image/jpeg'}],[{...image,data:'not base64'}],Array(4).fill(image),[{...image,data:'A'.repeat(700000)}]])expect(()=>imageAttachments(images)).toThrow();
  expect(()=>action({...request(),action:'prompt'})).toThrow();
 });
 it('forwards images once without putting image data or prompt in receipts',async()=>{
  const cmd=request(),hub=env.HUBS.get(env.HUBS.idFromName('photos-'+crypto.randomUUID()));
  const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role:'device',id:cmd.device_id,control:'1',expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});
  const ws=r.webSocket!;ws.accept();let sent=0;
  const received=new Promise<any>(resolve=>ws.addEventListener('message',e=>{const value=JSON.parse(e.data as string);if(value.type==='action'){sent++;resolve(value);}}));
  const setCaps=async(caps:string[])=>runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+cmd.device_id,{received:Date.now(),snapshot:snapshot({sessions:[{id:'test',control_key:'key',capabilities:caps}]})}));
  const post=(value:any)=>hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify(value)});
  await setCaps(['message']);expect((await post(cmd)).status).toBe(409);
  await setCaps(['message','message_images']);expect((await post(cmd)).status).toBe(202);
  expect((await received).attachments).toEqual([image]);expect((await post(cmd)).status).toBe(200);expect(sent).toBe(1);
  expect((await post({...cmd,attachments:[image,image]})).status).toBe(409);
  await runInDurableObject(hub,async(_i:any,state:any)=>{const data=JSON.stringify([...await state.storage.list()]);expect(data).not.toContain(png);expect(data).not.toContain('Inspect');});
  ws.close();
 });
 it('returns only bounded photo metadata in the conversation',()=>{
  const row={id:crypto.randomUUID(),text:'Photo',created:1,status:'queued',attachments:[{id:'a'.repeat(64),name:'Image 1.png',mime:'image/png',bytes:68,path:'/private/photo',data:png}]};
  const result=mailboxRows([row]);expect(result[0].attachments).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('/private');expect(JSON.stringify(result)).not.toContain(png);
 });
 it('exposes only a response phase for an actual pending reply',()=>{
  const row={id:crypto.randomUUID(),text:'question',created:1,status:'awaiting_reply',activity:{phase:'writing',observed_at:100,reasoning:'PRIVATE'}};
  expect(mailboxRows([row])[0].activity).toEqual({phase:'writing',observed_at:100});
  expect(JSON.stringify(mailboxRows([row]))).not.toContain('PRIVATE');
  expect(mailboxRows([{...row,status:'queued'}])[0].activity).toBeNull();
  expect(mailboxRows([{...row,status:'replied'}])[0].activity).toBeNull();
  expect(mailboxRows([{...row,activity:{phase:'invented',observed_at:100}}])[0].activity).toBeNull();
 });
});
