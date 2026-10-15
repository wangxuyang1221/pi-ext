import { setTimeout as delay } from 'node:timers/promises';
import { renderSubagentCall, renderSubagentResult } from './subagent/renderers.js';

const kinds = ['spawn', 'prompt', 'list', 'read', 'wait', 'close'];
const agent = { agentId: 'fixture-agent', name: 'Atlas', status: 'running', generation: 1, model: 'fixture/offline', thinkingLevel: 'high' };

/** Register display-only fixtures; no subagent runtime or tmux process is loaded. */
export function registerSubagentDemo(pi, faux, ai, busy) {
  let serial = 0;
  for (const [index, kind] of kinds.entries()) {
    pi.registerTool({
      name: `subagent_${kind}`, label: `Subagent ${kind}`, description: 'Offline subagent UI fixture',
      parameters: { type: 'object', properties: {
        agentId: { type: 'string' }, target: { type: 'string' }, task: { type: 'string' },
        text: { type: 'string' }, outcome: { type: 'string', enum: ['success', 'error', 'timeout'] },
      }, required: ['outcome'] },
      renderShell: 'self', executionMode: 'parallel',
      renderCall: (args, theme, context) => renderSubagentCall(kind, args, theme, context),
      renderResult: (result, options, theme, context) => renderSubagentResult(kind, context.args, result, options, theme, context),
      execute: async (_id, args, signal) => {
        await delay(2200 + index * 500, undefined, { signal });
        if (args.outcome === 'error') throw new Error('Fixture failure: agent is unavailable');
        const details = { operation: kind, ok: true, agent: { ...agent }, task: args.task, prompt: args.text };
        if (kind === 'list') details.agents = [agent, { ...agent, agentId: 'fixture-idle', name: 'Nova', status: 'settled' }];
        if (kind === 'read') Object.assign(details, { view: 'recent_activity', assistantCount: 1, toolCount: 0, activity: [{
          kind: 'assistant', id: 'fixture-message', timestamp: '2026-01-01T00:00:00Z', text: 'Fixture review complete. No real worker was started.', stopReason: 'stop', truncated: false,
        }] });
        if (kind === 'wait') Object.assign(details, { outcome: args.outcome === 'timeout' ? 'timeout' : 'settled', durationMs: 4200 });
        if (kind === 'close') Object.assign(details, { affected: [{ ...agent, status: 'closed' }], relationshipRemoved: true, piSessionRetained: true });
        return { content: [{ type: 'text', text: 'Offline fixture result' }], details };
      },
    });
  }
  pi.registerCommand('agents', { description: 'Play subagent prefix fixtures: mixed|success|error', handler: async (args, ctx) => {
    if (busy(ctx)) return;
    const mode = args.trim() || 'mixed';
    if (!['mixed', 'success', 'error'].includes(mode)) { ctx.ui.notify('Use /agents mixed|success|error', 'info'); return; }
    faux.setResponses([
      ai.fauxAssistantMessage(kinds.map((kind, index) => ({
        type: 'toolCall', id: `subagent-fixture-${++serial}`, name: `subagent_${kind}`,
        arguments: { agentId: agent.agentId, target: agent.agentId, task: 'Review tool prefixes', text: 'Check the error presentation',
          outcome: mode === 'mixed' ? kind === 'wait' ? 'timeout' : index === 1 ? 'error' : 'success' : mode },
      })), { stopReason: 'toolUse' }),
      ai.fauxAssistantMessage('Subagent playback complete. /agents mixed|success|error replays; /play shows other tools.'),
    ]);
    pi.sendUserMessage(`Subagent fixture: ${mode}`);
  } });
}
