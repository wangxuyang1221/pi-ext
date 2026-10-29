import { appendFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const [log, name] = process.argv.slice(2);
const record = data => appendFileSync(log, JSON.stringify({pid: process.pid, server: name, ...data}) + '\n');
record({type: 'start'});
const server = new Server({name, version:'1.0.0'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:['echo', 'other'].map(name => ({name, description:'Verification local tool', inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}))}));
server.setRequestHandler(CallToolRequestSchema, async req => {
  record({type:'call', tool:req.params.name, args:req.params.arguments});
  return {content:[{type:'text',text: String(req.params.arguments.text)}]};
});
await server.connect(new StdioServerTransport());
