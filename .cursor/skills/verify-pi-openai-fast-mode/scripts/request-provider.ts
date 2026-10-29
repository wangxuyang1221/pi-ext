import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { createProvider } from '@earendil-works/pi-ai';
import { responseEvents, textStep } from '../../../../extensions/goal/__tests__/budget-fixtures.mjs';

// Verification fixture: replace only HTTP transport; keep real CLI and request builders.
export default async function(pi: any) {
  const codex = await import(new URL('../../../../node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js', import.meta.url).href);
  const openai = await import(new URL('../../../../node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js', import.meta.url).href);
  const log = (type: string, data: any) => appendFileSync(join(process.env.PI_FAST_VERIFY_ROOT!, 'events.jsonl'), JSON.stringify({type, data, pid: process.pid})+'\n');
  const key = `offline.${Buffer.from(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'fixture'}})).toString('base64url')}.fixture`;
  for (const provider of ['openai', 'openai-codex', 'audit-other']) {
    const adapter = provider === 'openai-codex' ? codex : openai;
    const ids = provider === 'openai' ? ['gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6-astra-unknown'] : provider === 'openai-codex' ? ['gpt-7-unlisted', 'gpt-6-sol'] : ['gpt-6-astra'];
    const models = ids.map(id => ({id, name:id, provider, api:provider === 'openai-codex' ? 'openai-codex-responses' : 'openai-responses', baseUrl:'https://offline.invalid/v1', reasoning:true, input:['text'], cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:128000,maxTokens:4096}));
    const stream = (model: any, context: any, options: any) => {
      const user = context.messages.filter((m:any) => m.role === 'user').at(-1);
      const text = typeof user?.content === 'string' ? user.content : user?.content?.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n') ?? '';
      return adapter.streamSimple(model, context, {...options, apiKey:key,transport:'sse',maxRetries:0,fetch:async (_url:any, init:any)=>{
        const payload = JSON.parse(new Headers(init.headers).get('content-encoding') === 'zstd' ? zstdDecompressSync(init.body).toString('utf8') : String(init.body));
        log('request',{provider, text,payload});
        const step = text === 'reject-fast' ? {error:'unsupported_service_tier'} : text === 'ambiguous-error' ? {error:'HTTP 400 invalid input'} : textStep(`audit-reply:${text}`);
        return new Response(responseEvents(step, `audit_${Date.now()}`).map((e:any)=>`data: ${JSON.stringify(e)}\n\n`).join(''),{status:200,headers:{'content-type':'text/event-stream'}});
      }});
    };
    pi.registerProvider(createProvider({id:provider,models,auth:{apiKey:{name:'Offline',resolve:async()=>({auth:{}})}},api:{stream,streamSimple:stream}} as any));
  }
  pi.on('session_start', (_:any,ctx:any)=>log('ready',{sessionFile:ctx.sessionManager.getSessionFile(),sessionId:ctx.sessionManager.getSessionId(),model:ctx.model}));
  pi.on('model_select', (e:any)=>log('model',e.model));
  pi.on('agent_settled',()=>log('settled',true));
}
