import {expect,it} from 'vitest';
import {snapshot} from '../src/protocol';

it('preserves collector names and runs without copying local evidence into cloud storage',()=>{
 const s=snapshot({sessions:[{id:'one',display_name:'Fable-Atlas',display_detail:'대화 · 프로젝트 · 터미널 2곳',
  display_status:'subagents',shape_unknown:false,runs:[{pid:10,birth:20,role:'interactive',connected:true,
   status:'idle',display_status:'idle',status_at:25,terminal_match:'confirmed',argv:['PRIVATE'],
   terminal:{handle:'term-one',title:'이름',worktreePath:'/PRIVATE',tabId:'/PRIVATE'},_registry:{secret:'PRIVATE'}},
   {pid:11,role:'background',connected:true,status:'subagents',display_status:'subagents',terminal:null}]}]}).sessions[0];
 expect(s.display_name).toBe('Fable-Atlas');expect(s.display_status).toBe('subagents');expect(s.runs).toHaveLength(2);
 expect(s.runs![0].terminal).toEqual({handle:'term-one',title:'이름'});
 expect(JSON.stringify(s)).not.toContain('PRIVATE');expect(s.shape_unknown).toBe(false);
});
it('keeps old snapshots compatible and bounds malformed new fields',()=>{
 expect(snapshot({sessions:[{id:'old'}]}).sessions[0].display_name).toBeUndefined();
 const s=snapshot({sessions:[{id:'one',runs:[null,{},...Array(300).fill({pid:Infinity,birth:-1})],
   display_name:'n'.repeat(1000),shape_unknown:'yes'}]}).sessions[0];
 expect(s.display_name).toHaveLength(200);expect(s.runs!.length).toBeLessThanOrEqual(250);
 expect(s.runs![0].pid).toBeNull();expect(s.shape_unknown).toBeUndefined();
});
