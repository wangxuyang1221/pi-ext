import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxProvider, fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// This audit substitutes only the model boundary and observes public events.
export default function (pi: ExtensionAPI) {
  const reasoning = process.env.AUDIT_REASONING === '1';
  const root = process.env.AUDIT_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ type, data }) + '\n');
  const faux = fauxProvider({
    api: 'verification-faux', tokensPerSecond: reasoning ? 160 : 400, tokenSize: { min: 12, max: 12 },
    ...(reasoning ? { models: [{ id: 'faux-reasoning', reasoning: true }] }
      : process.env.AUDIT_TEXT_ONLY === '1' ? { models: [{ id: 'faux-text-only', input: ['text'] }] } : {}),
  });
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
  pi.on('session_start', (event, ctx) => {
    record('commands', pi.getCommands());
    if (ctx.hasUI) record('themes', ctx.ui.getAllThemes().filter(theme => theme.path));
    record(event.type, event);
  });
  pi.on('resources_discover', event => record(event.type, event));
  pi.on('agent_start', event => record(event.type, event));
  pi.on('tool_execution_update', event => record(event.type, event));
  pi.on('tool_execution_end', event => record(event.type, event));
  pi.on('agent_settled', event => record(event.type, event));
  pi.on('session_before_compact', (event, ctx) => {
    const first = ctx.sessionManager.getBranch().findLast(entry => entry.type === 'message' && entry.message.role === 'user');
    if (first) return { compaction: { summary: 'Verification summary', firstKeptEntryId: first.id, tokensBefore: event.preparation.tokensBefore } };
  });
}
