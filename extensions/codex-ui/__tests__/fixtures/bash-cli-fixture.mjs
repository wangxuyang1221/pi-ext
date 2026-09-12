// Offline transport only. Execution, lifecycle, storage and UI use production Pi code.
import fs from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import codexUi from '../../dist/index.js';

const calls = [
  { name: 'bash', arguments: { command: "printf 'first\\nsecond\\nthird\\nfourth'; sleep 4\nprintf '\\nfifth' # " + 'long-command-'.repeat(20) + 'END-COMMAND' } },
  { name: 'bash', arguments: { command: 'true' } },
  { name: 'bash', arguments: { command: "printf 'failure-one\\nfailure-two\\nfailure-three\\nfailure-four'; exit 7" } },
  { name: 'bash', arguments: { command: 'printf timeout-before; sleep 3', timeout: 0.2 } },
  { name: 'bash', arguments: { command: "printf '%s\\n' {1..2100}" } },
  { name: 'bash', arguments: { command: "printf '%s\\n' {1..2100}; exit 9" } },
  { name: 'bash', arguments: { command: 'printf forbidden' } },
  { name: 'write', arguments: { path: 'created.txt', content: 'written\n' } },
  { name: 'read', arguments: { path: 'existing.txt' } },
  { name: 'edit', arguments: { path: 'existing.txt', edits: [{ oldText: 'old', newText: 'new' }] } },
];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export default function fixture(pi) {
  codexUi(pi);
  const trace = event => fs.appendFileSync(process.env.BASH_SMOKE_TRACE, JSON.stringify(event) + '\n');
  for (const event of ['tool_call', 'tool_result', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'agent_end', 'session_start', 'session_shutdown', 'session_tree', 'session_compact']) pi.on(event, trace);
  pi.on('session_start', (_event, ctx) => trace({ type: 'session-path', file: ctx.sessionManager.getSessionFile() }));
  let treeLeaf;
  pi.registerCommand('fixture-tree', {
    description: 'Exercise real tree navigation without executing tools',
    async handler(args, ctx) {
      if (args === 'cut') {
        treeLeaf = ctx.sessionManager.getLeafId();
        const target = ctx.sessionManager.getEntries().find(entry => entry.message?.toolCallId === 'bash-smoke-run-0');
        await ctx.navigateTree(target.id, { summarize: false });
      } else await ctx.navigateTree(treeLeaf, { summarize: false });
    },
  });
  pi.registerCommand('fixture-fork', {
    description: 'Exercise real fork restoration without executing tools',
    async handler(_args, ctx) { await ctx.fork(ctx.sessionManager.getLeafId(), { position: 'at' }); },
  });
  pi.on('session_before_compact', (event, ctx) => {
    const target = ctx.sessionManager.getBranch().findLast(entry => entry.message?.role === 'user');
    return { compaction: { summary: 'BASH-SMOKE-COMPACTED', firstKeptEntryId: target.id, tokensBefore: event.preparation.tokensBefore } };
  });
  pi.on('tool_call', event => {
    if (event.input.command === 'printf forbidden') return { block: true, reason: 'Fixture permission denied' };
  });
  pi.registerProvider('bash-smoke', {
    api: 'openai-responses', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-fixture',
    models: [{ id: 'fixture', name: 'Bash smoke fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model, context) {
      trace({ type: 'provider-captures', results: context.messages.filter(message => message.role === 'toolResult') });
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'toolUse', timestamp: Date.now() };
      void (async () => {
        stream.push({ type: 'start', partial: message });
        const last = context.messages.at(-1);
        if (last?.role !== 'user') {
          const text = 'BASH-SMOKE-DONE';
          message.content.push({ type: 'text', text }); message.stopReason = 'stop';
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: text, partial: message });
        } else {
          const prompt = typeof last.content === 'string' ? last.content : last.content.map(block => block.text ?? '').join('');
          const scene = prompt.includes('cancel') ? 'cancel' : prompt.includes('low') ? 'low' : 'run';
          const selected = scene === 'cancel' ? [{ name: 'bash', arguments: { command: 'printf cancel-before; sleep 20' } }]
            : scene === 'low' ? [{ name: 'bash', arguments: { command: 'printf low-power-output' } }] : calls;
          for (const [index, call] of selected.entries()) {
            const block = { type: 'toolCall', id: `bash-smoke-${scene}-${index}`, name: call.name, arguments: {} };
            message.content.push(block);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            if (scene === 'run' && index === 0) await pause(1800);
            block.arguments = call.arguments;
            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(call.arguments), partial: message });
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          }
        }
        stream.push({ type: 'done', reason: message.stopReason, message }); stream.end();
      })().catch(error => {
        message.stopReason = 'error'; message.errorMessage = String(error);
        stream.push({ type: 'error', reason: 'error', error: message }); stream.end();
      });
      return stream;
    },
  });
}
