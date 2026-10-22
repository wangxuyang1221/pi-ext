import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../../', import.meta.url));
export const work = resolve(repo, '.tmp/codex-compact-repair-proof');
mkdirSync(work, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(work, 'agent');
process.env.PI_OFFLINE = '1';
process.env.PI_TELEMETRY = '0';
export const network = { unexpected: 0 };
globalThis.fetch = async () => { network.unexpected++; throw new Error('Unexpected network request'); };

export const host = await import('@earendil-works/pi-coding-agent');
// This exact-version test oracle is internal to Pi, not an extension API proposal.
export const { prepareCompaction } = await import('../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js');
export const ai = await import('@earendil-works/pi-ai');
export const { getBuiltinModel } = await import('@earendil-works/pi-ai/providers/all');
export const { openaiCodexProvider } = await import('@earendil-works/pi-ai/providers/openai-codex');
export const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-codex-responses');
export const { transformMessages } = await import('@earendil-works/pi-ai/api/transform-messages');
export const native = await import('../../extensions/codex-compact/dist/native-compaction.js');
export const { createSessionCoordinator } = await import('../../extensions/codex-compact/dist/session-coordinator.js');
export const { createCompactionHashSnapshot, parseCompactionCatalog } = await import('../../extensions/codex-compact/dist/capabilities.js');
export const { default: compactExtension } = await import('../../extensions/codex-compact/dist/index.js');
export const { createBranchProjectionSnapshot } = await import('../../extensions/codex-compact/dist/session-projection.js');

for (const name of ['pi-ai', 'pi-coding-agent', 'pi-tui']) {
  assert.equal(JSON.parse(readFileSync(resolve(repo, 'node_modules/@earendil-works', name, 'package.json'), 'utf8')).version, '1.3.0');
}
export const model = { ...getBuiltinModel('openai-codex', 'gpt-5.5'), compat: {
  supportsMidConvoSystemMessages: true, supportsAdditionalTools: true,
} };
export const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export const apiKey = `a.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'offline-proof' } })).toString('base64url')}.c`;
export const declaration = name => ({ name, description: name, parameters: { type: 'object', properties: {} } });
export const definition = (name, extra = {}) => ({ ...declaration(name), label: name,
  execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }), ...extra });
export const user = text => ({ role: 'user', content: text, timestamp: 1 });
export const system = (content, extra = {}) => ({ role: 'system', content, timestamp: 1, ...extra });
export const assistant = (content, stopReason = 'stop', selected = model) => ({ role: 'assistant',
  provider: selected.provider, api: selected.api, model: selected.id, content, stopReason, timestamp: 1, usage });
export const toolCall = (name = 'read', id = 'call|fc_call') => ({ type: 'toolCall', name, id, arguments: {} });
export const result = (id = 'call|fc_call', name = 'read') => ({ role: 'toolResult', toolCallId: id,
  toolName: name, content: [{ type: 'text', text: 'result' }], isError: false, timestamp: 1 });
export const entries = messages => messages.map((message, index) => ({ type: 'message', id: `source-${index}`,
  parentId: index ? `source-${index - 1}` : null, timestamp: new Date(0).toISOString(), message }));
export const itemUser = text => ({ role: 'user', content: [{ type: 'input_text', text }] });
export const checkpoint = (selected = model, replacementHistory = [{ type: 'compaction', encrypted_content: 'offline-opaque' }]) => ({
  kind: native.NATIVE_COMPACTION_KIND, version: 2, modelKey: native.modelKey(selected), replacementHistory,
});
export const hashes = createCompactionHashSnapshot(parseCompactionCatalog({ models: [] }), 'https://chatgpt.com/backend-api');
export const json = value => JSON.parse(JSON.stringify(value));

// The provider performs its real normalization and serialization, then stops before HTTP.
export async function payload(messages, selected = model, tools = []) {
  let captured;
  const reply = await streamSimple(selected, ai.normalizeContext({ messages: host.convertToLlm(messages), tools }), {
    apiKey, transport: 'sse', maxRetries: 0,
    onPayload: value => { captured = structuredClone(value); throw new Error('Captured before HTTP'); },
    fetch: async () => { throw new Error('Serialization probe must not reach HTTP'); },
  }).result();
  assert.equal(reply.errorMessage, 'Captured before HTTP');
  assert.ok(captured);
  return captured;
}

export function sse(index, callName) {
  const item = callName
    ? { type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name: callName, arguments: '{}' }
    : { type: 'message', id: `msg_${index}`, role: 'assistant', content: [{ type: 'output_text', text: 'Finished', annotations: [] }] };
  return new Response([
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: `r_${index}`, status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

export async function sdk({ seed, factories = [], responses = [], autoCompaction = false } = {}) {
  const manager = seed ?? host.SessionManager.inMemory(work);
  const credentials = new ai.InMemoryCredentialStore();
  await credentials.modify(model.provider, async () => ({ type: 'oauth', access: apiKey, refresh: 'offline', expires: Date.now() + 600_000 }));
  const runtime = await host.ModelRuntime.create({ credentials, modelsStore: new ai.InMemoryModelsStore(),
    modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(openaiCodexProvider());
  const settings = host.SettingsManager.inMemory({ compaction: { enabled: autoCompaction, keepRecentTokens: 1 },
    retry: { enabled: false }, cacheWarming: 'off' });
  const observations = { payloads: [], errors: [], events: [], requests: 0, contexts: [] };
  let api, ctx;
  const loader = new host.DefaultResourceLoader({ cwd: work, agentDir: join(work, 'agent'), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    systemPromptOverride: () => 'Fixed prompt', extensionFactories: [pi => {
      api = pi;
      pi.on('context_with_system', event => { observations.contexts.push(structuredClone(event.messages)); });
      pi.on('before_provider_request', (_event, context) => { ctx = context; });
      for (const name of ['turn_end', 'agent_before_settle', 'agent_settled']) pi.on(name, event => {
        observations.events.push({ type: name, outcome: event.outcome, aborted: event.aborted,
          stopReason: event.message?.stopReason });
      });
    }, ...factories] });
  await loader.reload();
  const { session } = await host.createAgentSession({ cwd: work, agentDir: join(work, 'agent'), modelRuntime: runtime,
    model, resourceLoader: loader, sessionManager: manager, settingsManager: settings });
  await session.bindExtensions({ onError: error => observations.errors.push(error) });
  session.agent.streamFunction = (selected, context, options) => streamSimple(selected, context, {
    ...options, apiKey, transport: 'sse', maxRetries: 0,
    onPayload: async (value, selectedModel) => {
      const prepared = await options?.onPayload?.(value, selectedModel);
      observations.payloads.push(structuredClone(prepared ?? value));
      return prepared;
    },
    fetch: async () => {
      assert.ok(observations.requests < 8, 'Unexpected SDK continuation loop');
      const index = observations.requests++;
      return sse(index, responses[index]);
    },
  });
  return { session, manager, observations, api, context: () => ctx,
    close: async () => { await session.abort(); await session.waitForIdle(); session.dispose(); } };
}

export const wire = p => json({ input: p.input, instructions: p.instructions, tools: p.tools ?? [] });
export const wireKinds = input => input.map(item => item.type ?? item.role);
