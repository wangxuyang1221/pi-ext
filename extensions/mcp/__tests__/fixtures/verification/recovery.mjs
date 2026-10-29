import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdirSync,writeFileSync} from 'node:fs';
import {McpClientManager} from '../../../dist/client.js';
import {LocalHttpMcpFixture} from '../http-mcp-fixture.ts';
const directory=new URL('../../../../../.tmp/test-results/mcp-recovery-'+Date.now()+'/',import.meta.url);
mkdirSync(directory,{recursive:true});
const proof=[];
async function wait(predicate){const deadline=Date.now()+3000;while(!predicate()){assert(Date.now()<deadline,'Condition deadline exceeded');await delay(10);}}
for(const mode of ['retry-sequence','protocol','authentication','connect-total-deadline','background','manual-generation']){
 const fixture=await LocalHttpMcpFixture.start(mode==='retry-sequence'?{failures:Array.from({length:3},()=>({kind:'status',status:503}))}:mode==='protocol'?{failures:[{kind:'protocol',code:-32600}]}:mode==='authentication'?{failures:[{kind:'status',status:401}]}:mode==='connect-total-deadline'?{listFailures:[{kind:'status',status:503},{kind:'timeout'}],responseDelayMs:100}:{failures:[{kind:'status',status:503}]});
 const manager=new McpClientManager({random:()=>1});const port=+new URL(fixture.url).port;const begin=Date.now();let result={mode,port};
 try{
  const state=await manager.connectServer('remote',{type:'streamable-http',url:fixture.url,connectTimeout:mode==='connect-total-deadline'?1500:3000,retry:{maxAttempts:['background','manual-generation'].includes(mode)?1:4,baseDelayMs:80,factor:2,maxDelayMs:250,background:['background','manual-generation'].includes(mode),backgroundMaxDelayMs:300}});
  if(mode==='retry-sequence'){
   assert(state.connected);const times=fixture.requests.filter(r=>r.method==='initialize').map(r=>r.at);const gaps=times.slice(1).map((t,i)=>t-times[i]);assert.equal(times.length,4);for(const [i,expected] of [80,160,250].entries())assert(gaps[i]>=expected-10&&gaps[i]<expected+450,'Real network retry delay outside bounded exponential schedule');result.gaps=gaps;
  }else if(mode==='protocol'||mode==='authentication'){
   assert(!state.connected);assert.equal(state.lastError.category,mode==='protocol'?'protocol':'auth');await delay(400);assert.equal(fixture.count('initialize'),1);
  }else if(mode==='connect-total-deadline'){
   assert(!state.connected);assert.equal(state.lastError.category,'timeout');assert.equal(fixture.count('initialize'),2);assert.equal(fixture.count('tools/list'),2);assert(Date.now()-begin>=1400&&Date.now()-begin<3000);await wait(()=>fixture.abortedMethods.includes('tools/list'));
  }else if(mode==='background'){
   assert(!state.connected);await wait(()=>manager.isServerConnected('remote'));assert.equal(fixture.count('initialize'),2);assert.equal((await manager.callTool('mcp__remote__echo',{text:'background-recovered'})).content[0].text,'background-recovered');
  }else{
   const generation=state.generation;await manager.reconnectServer('remote');assert(manager.getServerState('remote').generation>generation);await delay(650);assert.equal(fixture.count('initialize'),2);
  }
  result={...result,passed:true,elapsed:Date.now()-begin,requests:fixture.requests,aborted:fixture.abortedMethods};
 }catch(error){result={...result,passed:false,error:String(error),requests:fixture.requests};process.exitCode=1;}
 finally{await manager.shutdown();await fixture.close();const refused=await new Promise(resolve=>{const socket=connect(port,'127.0.0.1');socket.once('error',error=>{socket.destroy();resolve(error.code==='ECONNREFUSED')});socket.once('connect',()=>{socket.destroy();resolve(false)});});result.cleanup={listening:fixture.server.listening,sockets:fixture.sockets.size,refused};assert(refused);assert.equal(fixture.sockets.size,0);proof.push(result);writeFileSync(new URL('summary.json',directory),JSON.stringify(proof,null,2));}
}
console.log(JSON.stringify({evidence:directory.pathname,passed:proof.every(row=>row.passed)}));
