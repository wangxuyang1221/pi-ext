import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
// Replace only the model boundary; tools and permission policy remain real.
export default function (pi: ExtensionAPI): void {
  const root = process.env.PI_VERIFY_ROOT!;
  const record = (type: string, data: unknown) => appendFileSync(join(root, 'events.jsonl'), JSON.stringify({type, data}) + '\n');
  const faux = fauxProvider({api: 'permissions-faux', tokensPerSecond: 1000000});
  faux.setResponses(Array.from({length: 4000}, () => async context => {
    const last = context.messages.at(-1);
    record('request', last);
    if (last?.role === 'user') {
      const content = typeof last.content === 'string' ? last.content : last.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      if (content.startsWith('VERIFY_TOOL ')) {
        const input = JSON.parse(content.slice(12));
        return fauxAssistantMessage({type: 'toolCall', id: `verify-${Date.now()}`, name: input.name, arguments: input.args}, {stopReason: 'toolUse'});
      }
    }
    return fauxAssistantMessage('Verification response');
  }));
  pi.registerProvider(faux.provider);
  pi.on('resources_discover', () => record('ready', true));
  pi.on('tool_execution_end', event => record('tool', event));
  pi.on('agent_settled', () => record('settled', true));
}
