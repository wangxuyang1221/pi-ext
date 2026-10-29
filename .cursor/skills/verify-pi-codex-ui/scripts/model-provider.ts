import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import { createCodemodeExtension } from '@earendil-works/pi-coding-agent';

// This audit substitutes only the model boundary and observes public events.
export default function (pi: any) {
  createCodemodeExtension({ models: false })(pi);
  const root = process.env.AUDIT_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ type, data }) + '\n');
  const faux = fauxProvider({ api: 'verification-faux', ...(process.env.UI_VERIFY_FOOTER === '1' ? { provider: 'openai', models: [{ id: 'gpt-5.4', reasoning: true }] } : {}), tokensPerSecond: 400, tokenSize: { min: 12, max: 12 } });
  faux.setResponses(Array.from({ length: 500 }, () => async context => {
    record('request', context.messages);
    const last = context.messages.at(-1);
    const plan = JSON.parse(readFileSync(join(root, 'plan.json'), 'utf8'));
    if (last?.role === 'user') {
      if (plan.calls) return fauxAssistantMessage(plan.calls.map((call: any, i: number) => ({ type: 'toolCall', id: `audit-${Date.now()}-${i}`, ...call })), { stopReason: 'toolUse' });
      if (plan.thinking) return fauxAssistantMessage([{ type: 'thinking', thinking: plan.thinking }, { type: 'text', text: plan.reply }], plan.error ? { stopReason: 'error', errorMessage: 'Verification provider error' } : {});
    }
    return fauxAssistantMessage(plan.reply || 'AUDIT-DONE');
  }));
  pi.registerProvider(faux.provider);
  pi.on('session_start', () => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), 'codemode'])]);
    record('commands', pi.getCommands());
  });
  for (const type of ['resources_discover', 'session_start', 'agent_start', 'tool_execution_end', 'agent_settled']) {
    pi.on(type, event => record(type, event));
  }
  pi.on('session_before_compact', (event, ctx) => {
    const first = ctx.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'user');
    if (first) return { compaction: { summary: 'Verification summary', firstKeptEntryId: first.id, tokensBefore: event.preparation.tokensBefore } };
  });
}
