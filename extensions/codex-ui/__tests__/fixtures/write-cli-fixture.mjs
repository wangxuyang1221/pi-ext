// Offline model transport only. All file operations and tool renderers are production code.
import fs from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import codexUi from '../../dist/index.js';
import permissions from '../../../permissions/dist/index.js';
import mcp from '../../../mcp/dist/index.js';
import goal from '../../../goal/dist/index.js';
import subagent from '../../../subagent/dist/index.js';
import compact from '../../../codex-compact/dist/index.js';
import fastMode from '../../../openai-fast-mode/dist/index.js';

const content = Array.from({ length: 20 }, (_, i) => `const item${i} = ${i};\n`).join('');
const calls = [
  { name: 'write', arguments: { path: 'new.ts', content } },
  { name: 'edit', arguments: { path: 'edit.ts', edits: [{ oldText: 'oldEdit', newText: 'newEdit' }] } },
  { name: 'write', arguments: { path: 'existing.ts', content: 'const newValue = 2;\n' } },
  { name: 'write', arguments: { path: '.', content: 'directory write must fail' } },
  { name: 'edit', arguments: { path: 'missing.ts', edits: [{ oldText: 'missing', newText: 'replacement' }] } },
  { name: 'write', arguments: { path: 'large.ts', content: 'small\n' } },
  { name: 'write', arguments: { path: 'blocked.ts', content: 'must not be written' } },
];
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function fixture(pi) {
  for (const extension of [compact, fastMode, permissions, codexUi, mcp, subagent, goal]) extension(pi);
  const trace = event => fs.appendFileSync(process.env.WRITE_SMOKE_TRACE, JSON.stringify(event) + '\n');
  for (const event of ['tool_call', 'tool_result', 'tool_execution_end', 'agent_end']) pi.on(event, trace);
  pi.on('tool_call', event => {
    const allowed = calls.slice(0, -1).some(call => call.name === event.toolName
      && JSON.stringify(call.arguments) === JSON.stringify(event.input));
    if (!allowed) return { block: true, reason: 'Fixture permission denied' };
  });
  pi.registerProvider('write-smoke', {
    api: 'openai-responses', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-fixture',
    models: [{ id: 'fixture', name: 'Write smoke fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage, stopReason: 'toolUse', timestamp: Date.now() };
      void (async () => {
        stream.push({ type: 'start', partial: message });
        if (context.messages.some(item => item.role === 'toolResult')) {
          message.content.push({ type: 'text', text: 'WRITE-SMOKE-DONE' });
          message.stopReason = 'stop';
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: 'WRITE-SMOKE-DONE', partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: 'WRITE-SMOKE-DONE', partial: message });
        } else {
          for (const [index, call] of calls.entries()) {
            const block = { type: 'toolCall', id: `write-smoke-${index}`, name: call.name, arguments: { path: call.arguments.path } };
            message.content.push(block);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(block.arguments), partial: message });
            if (index < 2) await pause(3000);
            block.arguments = call.arguments;
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          }
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })().catch(error => {
        message.stopReason = 'error'; message.errorMessage = String(error);
        stream.push({ type: 'error', reason: 'error', error: message }); stream.end();
      });
      return stream;
    },
  });
}
