import {createServer} from 'node:http';
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {SSEServerTransport} from '@modelcontextprotocol/sdk/server/sse.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {LocalHttpMcpFixture} from '../http-mcp-fixture.ts';
const root=process.argv[2];
const log=(type,data={})=>appendFileSync(root+'/server.jsonl',JSON.stringify({at:Date.now(),type,...data})+'\n');
const http=await LocalHttpMcpFixture.start({toolCallFailures:[{kind:'interrupt'}]});
const offline=await LocalHttpMcpFixture.start({failures:Array.from({length:100},()=>({kind:'status',status:503}))});
const sessions=new Map(),sockets=new Set(),handlers=new Set();
const sse=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'){
   const transport=new SSEServerTransport('/messages',res);
   const server=new Server({name:'audit-sse',version:'1'},{capabilities:{tools:{},logging:{}}});
   server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'schema',inputSchema:{type:'object',properties:{kind:{const:'fixed'},nested:{type:'object',properties:{choice:{anyOf:[{type:'string'},{type:'number'}]}},required:['choice'],additionalProperties:false},extra:{type:'object',additionalProperties:{type:'string'}}},required:['kind','nested'],additionalProperties:false}},{name:'media',inputSchema:{type:'object',properties:{}}},{name:'work',inputSchema:{type:'object',properties:{mode:{type:'string'}},required:['mode']},annotations:{readOnlyHint:true}}]}));
   server.setRequestHandler(CallToolRequestSchema,(request,extra)=>{
    const work=(async()=>{
     if(request.params.name==='schema'){log('schema-call',{arguments:request.params.arguments});return {content:[{type:'text',text:'SCHEMA ACCEPTED'}]};}
     if(request.params.name==='media'){log('media-call');return {content:[{type:'text',text:'MEDIA RESULT'},{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='}],structuredContent:{marker:'STRUCTURED-RESULT'}};}
     const mode=request.params.arguments.mode;log('call',{mode});
     if(mode==='diagnostics'){await extra.sendNotification({method:'notifications/message',params:{level:'warning',data:{marker:'REDACTION-CATEGORIES',headers:{Authorization:'Bearer synthetic-auth-secret',Cookie:'sid=synthetic-cookie-secret'},env:{KEY:'synthetic-env-secret'},url:'https://synthetic-user:synthetic-password@example.test/mcp?token=synthetic-query-secret'}}});return {content:[{type:'text',text:'DIAGNOSTIC SENT'}]};}
     extra.signal.addEventListener('abort',()=>log('cancel',{mode}),{once:true});
     const token=request.params._meta?.progressToken, started=Date.now();
     if(mode==='error')return{content:[{type:'text',text:'AUDIT BUSINESS ERROR'}],isError:true};
     const duration=mode==='complete'?600:mode==='quick'?0:10000;
     let updates=0;
     while(!extra.signal.aborted&&Date.now()-started<duration){
      if(token!==undefined&&mode!=='silent'){await extra.sendNotification({method:'notifications/progress',params:{progressToken:token,progress:++updates,total:200}});log('progress',{mode,updates});}
      await new Promise(r=>setTimeout(r,50));
     }
     log('finish',{mode,elapsed:Date.now()-started,aborted:extra.signal.aborted});
     return{content:[{type:'text',text:'AUDIT SSE '+mode}],isError:false};
    })();handlers.add(work);work.finally(()=>handlers.delete(work));return work;
   });
   sessions.set(transport.sessionId,{server,transport});await server.connect(transport);
  }else await sessions.get(url.searchParams.get('sessionId')).transport.handlePostMessage(req,res);
 }catch(e){log('server-error',{error:String(e)});if(!res.writableEnded)res.end();}
});
sse.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
await new Promise(r=>sse.listen(0,'127.0.0.1',r));
const state={pid:process.pid,offline:offline.url,http:http.url,sse:`http://127.0.0.1:${sse.address().port}/sse`};
writeFileSync(root+'/services.json',JSON.stringify(state));log('ready',state);
const timer=setInterval(()=>writeFileSync(root+'/http-requests.json',JSON.stringify({requests:http.requests,offline:offline.requests,aborted:http.abortedMethods})),50);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);await http.close();await offline.close();await Promise.allSettled([...sessions.values()].map(v=>v.server.close()));for(const s of sockets)s.destroy();await new Promise(r=>sse.close(r));await Promise.allSettled(handlers);writeFileSync(root+'/http-requests.json',JSON.stringify({requests:http.requests,offline:offline.requests,aborted:http.abortedMethods}));log('closed',{offlineListening:offline.server.listening,httpListening:http.server.listening,sseListening:sse.listening,sockets:sockets.size});process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
