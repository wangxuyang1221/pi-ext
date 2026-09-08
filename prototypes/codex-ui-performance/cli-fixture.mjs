// Test-only offline provider. Production Bash executes the exact harmless fixture commands.
import fs from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
const { default: codexUi } = await import(process.env.PI_SMOKE_BASELINE === '1'
  ? './.generated/before/index.js' : '../../extensions/codex-ui/dist/index.js');
const { default: mcp } = await import(process.env.PI_SMOKE_BASELINE === '1'
  ? './.generated/before/mcp/index.js' : '../../extensions/mcp/dist/index.js');

export const summaryText = Array.from({ length: 8 }, (_, index) => `${index === 7 ? 'MCP-EXPANDED-TAIL' : `MCP-PREVIEW-${index}`} ${'detail '.repeat(7)}`).join('\n');

const commands = [
  "printf 'LIVE-FIRST\\n'; sleep 1; printf 'LIVE-FIRST-END\\n'",
  "printf 'LIVE-SECOND\\n'; sleep 1; printf 'LIVE-SECOND-END\\n'",
  "printf 'Error: LIVE-FAIL\\n'; sleep 1; exit 1",
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export default function fixture(pi) {
  codexUi(pi);
  const summary = process.env.PI_SMOKE_SUMMARY === '1';
  const read = process.env.PI_SMOKE_READ === '1';
  if (summary) mcp(pi);
  const trace = event => fs.appendFileSync(process.env.PI_SMOKE_TRACE, JSON.stringify(event) + '\n');
  for (const name of ['message_start', 'message_update', 'message_end', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'agent_end']) {
    pi.on(name, event => trace(event));
  }
  pi.on('tool_call', event => {
    if (read) return event.toolName === 'read' && ['first.txt', 'second.txt', 'missing.txt'].includes(event.input.path)
      ? undefined : { block: true, reason: 'Only local Read smoke fixtures are allowed.' };
    if (summary && ((event.toolName === 'write' && ['summary.txt', '.'].includes(event.input.path))
      || (event.toolName === 'mcp__fixture__echo' && event.input.text === summaryText))) return;
    if (summary || event.toolName !== 'bash' || !commands.includes(event.input.command)) {
      return { block: true, reason: 'Only exact smoke fixture commands are allowed.' };
    }
  });
  pi.registerProvider('grouped-smoke', {
    api: 'openai-responses', baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture-not-a-secret',
    models: [{ id: 'fixture', name: 'Grouped smoke fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage, stopReason: 'toolUse', timestamp: Date.now() };
      void (async () => {
        stream.push({ type: 'start', partial: message });
        if (context.messages.some(item => item.role === 'toolResult')) {
          message.content.push({ type: 'text', text: 'LIVE-DONE' });
          message.stopReason = 'stop';
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: 'LIVE-DONE', partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: 'LIVE-DONE', partial: message });
        } else if (read) {
          for (const [index, args] of [{ path: 'first.txt' }, { path: 'second.txt', offset: 2, limit: 2 }, { path: 'missing.txt' }].entries()) {
            const block = { type: 'toolCall', id: `live-read-${index}`, name: 'read', arguments: {} };
            message.content.push(block);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            await pause(750);
            block.arguments = args;
            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(args), partial: message });
            await pause(750);
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          }
        } else if (summary) {
          const calls = [
            { name: 'write', path: 'summary.txt' },
            { name: 'write', path: '.' },
            { name: 'mcp__fixture__echo' },
          ];
          for (const [index, call] of calls.entries()) {
            const block = { type: 'toolCall', id: `summary-${index}`, name: call.name, arguments: {} };
            message.content.push(block);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            if (call.name === 'write') {
              for (const count of [0, 3, 10, 20]) {
                block.arguments = { path: call.path, content: Array.from({ length: count }, (_, line) => `line ${line}`).join('\n') };
                stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(block.arguments), partial: message });
                await pause(index === 0 ? 900 : 50);
              }
            } else block.arguments = { text: summaryText };
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          }
        } else {
          for (const [index, command] of commands.entries()) {
            const block = { type: 'toolCall', id: `live-bash-${index}`, name: 'bash', arguments: {} };
            message.content.push(block);
            stream.push({ type: 'toolcall_start', contentIndex: index, partial: message });
            await pause(250);
            block.arguments = { command: command.slice(0, 16) };
            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(block.arguments), partial: message });
            await pause(250);
            block.arguments = { command };
            stream.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          }
        }
        stream.push({ type: 'done', reason: message.stopReason, message });
        stream.end();
      })().catch(error => { message.stopReason = 'error'; message.errorMessage = String(error); stream.push({ type: 'error', reason: 'error', error: message }); stream.end(); });
      return stream;
    },
  });
}
