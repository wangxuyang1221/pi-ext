import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createProvider, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
export default function(pi: any) {
  const home = process.env.HOME!;
  const log = (type: string, data: any) => appendFileSync(join(home, `events-${process.pid}.jsonl`), JSON.stringify({type, data, pid:process.pid, at:Date.now()})+'\n');
  globalThis.fetch = async () => { log('network-blocked', true); throw new Error('Network disabled in audit'); };
  pi.registerTool({ name: 'audit_echo', label: 'Echo fixture', description: 'Return a bounded deterministic tool fixture.',
    parameters: Type.Object({ text: Type.String(), fail: Type.Optional(Type.Boolean()) }),
    async execute(_id: string, args: any) {
      if (args.fail) throw new Error('Controlled tool failure');
      return { content: [{ type: 'text', text: 'RESULT_BEGIN_' + '文'.repeat(40000) + '_RESULT_END' }] };
    },
  });
  const stream = (model: any, context: any, options: any) => {
    const result = createAssistantMessageEventStream();
    void (async () => {
      const last = context.messages.at(-1);
      const user = context.messages.filter((m:any)=>m.role==='user').at(-1);
      const text = typeof user?.content==='string' ? user.content : user?.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n') ?? '';
      log('request', {text, tools:context.tools?.map((t:any)=>t.name), model:model.id});
      const output:any = {role:'assistant', content:[], api:'audit', provider:'audit', model:model.id, timestamp:Date.now(), stopReason:'stop', usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      try {
        result.push({type:'start', partial:output});
        if (text.startsWith('AUDIT_TOOL ') && last?.role==='user') {
          const call=JSON.parse(text.slice(11));
          if (call.args?.text === 'GENERATE_LONG_USER') call.args.text = 'LONG_USER_' + '字'.repeat(12000);
          output.content=[{type:'toolCall',id:`audit-${Date.now()}`,name:call.name,arguments:call.args}]; output.stopReason='toolUse';
        } else if (!text.startsWith('AUDIT_TOOL ') && text.includes('TOOL_CHILD') && last?.role === 'user') {
          output.content=[{type:'toolCall',id:`echo-${Date.now()}`,name:'audit_echo',arguments:{text:'ARGS_BEGIN_'+'参'.repeat(12000)+'_ARGS_END',fail:text.includes('FAIL_TOOL_CHILD')}}];output.stopReason='toolUse';
        } else {
          if (text === 'HOLD_ROOT') { log('root-holding', true); while (!options?.signal?.aborted) await new Promise(r=>setTimeout(r,20)); throw new Error('Root aborted'); }
          if (!text.startsWith('AUDIT_TOOL ') && text.includes('HOLD_CHILD')) { log('holding', true); while(!existsSync(join(home,'release'))) {if(options?.signal?.aborted) throw new Error('Aborted'); await new Promise(r=>setTimeout(r,20));} }
          if (!text.startsWith('AUDIT_TOOL ') && text.includes('ERROR_CHILD')) { output.content=[{type:'text',text:'PARTIAL_BEFORE_ERROR'}]; throw new Error('Controlled child error '+'e'.repeat(24000)); }
          output.content=[{type:'text',text:!text.startsWith('AUDIT_TOOL ') && text.includes('LARGE_CHILD') ? 'LARGE_BEGIN_'+'字'.repeat(40000)+'_LARGE_END' : `AUDIT_DONE ${text}`}];
        }
        result.push({type:'done',reason:output.stopReason,message:output});
      } catch(e) {output.stopReason=options?.signal?.aborted?'aborted':'error';if(options?.signal?.aborted)log('aborted',text);output.errorMessage=String(e);result.push({type:'error',reason:output.stopReason,error:output});}
      result.end();
    })(); return result;
  };
  pi.registerProvider(createProvider({id:'audit', models:['deterministic','role'].map(id=>({id,name:id,provider:'audit',api:'audit',baseUrl:'https://offline.invalid',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:200000})),auth:{apiKey:{name:'Offline',resolve:async()=>({auth:{}})}},api:{stream,streamSimple:stream}}));
  pi.on('session_start',(_e:any,ctx:any)=>log('session',{id:ctx.sessionManager.getSessionId(),file:ctx.sessionManager.getSessionFile()}));
  pi.on('resources_discover',()=>log('ready',true));
  pi.on('tool_execution_end',(e:any)=>log('tool',e));
  pi.on('agent_settled',()=>log('settled',true));
  pi.on('session_tree',(e:any)=>log('tree',e));
}
