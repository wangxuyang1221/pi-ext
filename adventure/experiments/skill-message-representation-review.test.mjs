import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

// Decision probes only. Methods are extracted verbatim from the pinned source.
// The extension runner, resource loader, model runtime, and queue sinks are fakes.
// No model request or full AgentSession/extension lifecycle is exercised.
const hashes = {
  'core/agent-session.ts': '3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865',
  'core/messages.ts': '5397e3c96c9504266e4ee8b6e88d5098b3280ee7dbb0c687b74708c62a06c8d4',
  'core/session-manager.ts': '860b01d430633431591393e7d14c2cafff792c1c1c374ce18067e0a7e3f59357',
};
function source(path) {
  let text;
  if (process.env.PI_REVIEW_SOURCE_ROOT) {
    text = readFileSync(join(process.env.PI_REVIEW_SOURCE_ROOT, 'packages/coding-agent/src', path), 'utf8');
  } else {
    const map = JSON.parse(readFileSync(join('node_modules/@earendil-works/pi-coding-agent/dist', path.replace(/\.ts$/, '.js.map')), 'utf8'));
    const index = map.sources.findIndex(name => name.endsWith(path));
    assert.ok(index >= 0, `Missing source map entry: ${path}`);
    text = map.sourcesContent[index];
  }
  assert.equal(createHash('sha256').update(text).digest('hex'), hashes[path], `Pinned source mismatch: ${path}`);
  return text;
}
const agentSource = source('core/agent-session.ts');
const sessionSource = source('core/session-manager.ts');
const messages = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source('core/messages.ts'))).toString('base64'));

function method(name) {
  const marker = new RegExp('^\\t(?:(?:private|public|async) )*' + name + '(?:<[^\\n]+>)?\\(', 'm');
  const match = marker.exec(agentSource);
  assert.ok(match, `Missing method: ${name}`);
  const end = agentSource.indexOf('\n\t}', match.index);
  assert.ok(end >= match.index, `Missing method end: ${name}`);
  return agentSource.slice(match.index, end + 3);
}
function topLevelFunction(text, name) {
  const match = new RegExp('^(?:export )?function ' + name + '\\(', 'm').exec(text);
  assert.ok(match, `Missing function: ${name}`);
  const end = text.indexOf('\n}', match.index);
  return text.slice(match.index, end + 2).replace(/^export /, '');
}
const methodNames = ['_runInputHandlers', 'prompt', '_expandSkillCommand', '_queueUserInput', '_queueSteer', '_queueFollowUp', 'sendCustomMessage', 'clearQueue'];
const MethodProbe = new Function('expandPromptTemplate', 'readFileSync', 'stripFrontmatter', stripTypeScriptTypes(
  'class MethodProbe {\n' + methodNames.map(method).join('\n') + '\n}',
) + '\nreturn MethodProbe;')(
  text => text,
  () => { throw new Error('Unexpected skill file read: this probe supplies snapshots directly'); },
  () => { throw new Error('Unexpected frontmatter parsing'); },
);
const parseSkillBlock = new Function(stripTypeScriptTypes(topLevelFunction(agentSource, 'parseSkillBlock')) + '\nreturn parseSkillBlock;')();
const contextFunctions = ['buildEntryIndex', 'buildSessionPath', 'getSessionContextSettings', 'sessionEntryToContextMessages', 'buildContextEntries', 'buildSessionContext'];
const buildSessionContext = new Function('createCustomMessage', 'createBranchSummaryMessage', 'createCompactionSummaryMessage',
  stripTypeScriptTypes(contextFunctions.map(name => topLevelFunction(sessionSource, name)).join('\n')) + '\nreturn buildSessionContext;',
)(messages.createCustomMessage, messages.createBranchSummaryMessage, messages.createCompactionSummaryMessage);

const image = { type: 'image', data: 'fixture-image-data', mimeType: 'image/png' };
const nativeA = '<skill name="adventure" location="/fixture/adventure/SKILL.md">\nReferences are relative to /fixture/adventure.\n\nBODY_A\n</skill>';
const nativeB = '<skill name="review" location="/fixture/review/SKILL.md">\nReferences are relative to /fixture/review.\n\nBODY_B\n</skill>';
// This envelope is an experimental fixture, not a selected product protocol.
const task = 'Plan with $adventure';
const envelope = '<skill-mentions version="1">\n' + nativeA + '\n\n' + nativeB + '\n</skill-mentions>\n\n' + task;
const nativeText = nativeA + '\n\n' + task;
function host(transform = text => text) {
  const result = new MethodProbe();
  result.isStreaming = false;
  result.model = { provider: 'fixture' };
  result._modelRuntime = { hasConfiguredAuth: () => true };
  result._baseSystemPromptOptions = { selectedTools: [] };
  result._pendingNextTurnMessages = [];
  result._pendingCustomMessages = [];
  result._steeringMessages = [];
  result._followUpMessages = [];
  result.calls = [];
  result.promptTemplates = [];
  result._extensionRunner = {
    hasHandlers: () => true,
    emitInput: async (text, images, source, behavior) => {
      result.calls.push({ kind: 'input', source, behavior });
      return { action: 'transform', text: transform(text) };
    },
    emitBeforeAgentStart: async (_text, _images, options) => {
      result.calls.push({ kind: 'before_agent_start' });
      return { systemPromptOptions: options, messages: [] };
    },
  };
  result._tryExecuteExtensionCommand = async () => false;
  result._throwIfExtensionCommand = () => {};
  result._flushPendingBashMessages = () => {};
  result._flushPendingCustomMessages = () => {};
  result._findLastAssistantMessage = () => undefined;
  result._preparePromptAndToolLoadout = () => undefined;
  result.getActiveToolNames = () => [];
  result._runAgentPrompt = async message => result.calls.push({ kind: 'prompt', message });
  result._emitQueueUpdate = () => result.calls.push({ kind: 'queue_update' });
  result.agent = {
    steer: message => result.calls.push({ kind: 'steer', message }),
    followUp: message => result.calls.push({ kind: 'followUp', message }),
    clearAllQueues: () => result.calls.push({ kind: 'clearAllQueues' }),
  };
  return result;
}

test('actual parser distinguishes the native skill shape from a user envelope', () => {
  assert.equal(parseSkillBlock(nativeText).name, 'adventure');
  assert.equal(parseSkillBlock(envelope), null);
  const double = parseSkillBlock(nativeA + '\n\n' + nativeB);
  assert.equal(double.name, 'adventure');
  assert.equal(double.userMessage, nativeB);
  const single = parseSkillBlock(nativeA + '\n' + nativeB);
  assert.equal(single.name, 'adventure');
  assert.ok(single.content.includes('</skill>\n<skill'));
  assert.equal(single.userMessage, undefined);
});

test('actual prompt preserves envelope snapshots, user role, images, and before_agent_start', async () => {
  const h = host(() => envelope);
  await h.prompt(task, { images: [image], source: 'interactive' });
  const sent = h.calls.find(call => call.kind === 'prompt').message;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].role, 'user');
  assert.deepEqual(sent[0].content, [{ type: 'text', text: envelope }, image]);
  assert.equal(h.calls.filter(call => call.kind === 'before_agent_start').length, 1);
  assert.deepEqual(messages.convertToLlm(sent), sent);
});

for (const behavior of ['steer', 'followUp']) {
  test(`actual ${behavior} queue carries complete per-message snapshots and images`, async () => {
    const h = host(text => text === task ? envelope : 'SECOND_SNAPSHOT');
    h.isStreaming = true;
    await h._queueUserInput(task, [image], behavior, 'interactive');
    await h._queueUserInput('second input', undefined, behavior, 'interactive');
    const calls = h.calls.filter(call => call.kind === behavior);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].message.content, [{ type: 'text', text: envelope }, image]);
    assert.deepEqual(calls[1].message.content, [{ type: 'text', text: 'SECOND_SNAPSHOT' }]);
    const queue = behavior === 'steer' ? h._steeringMessages : h._followUpMessages;
    assert.deepEqual(queue, [envelope, 'SECOND_SNAPSHOT']);
    const restored = h.clearQueue();
    assert.deepEqual(restored[behavior === 'steer' ? 'steering' : 'followUp'], [envelope, 'SECOND_SNAPSHOT']);
  });
}

test('actual session projection restores user and custom snapshots without skill files', () => {
  const entries = JSON.parse(JSON.stringify([
    { id: 'a', parentId: null, type: 'message', timestamp: '2026-09-20T00:00:00Z', message: { role: 'user', content: [{ type: 'text', text: envelope }, image], timestamp: 1 } },
    { id: 'b', parentId: 'a', type: 'custom_message', timestamp: '2026-09-20T00:00:01Z', customType: 'review-fixture', content: [{ type: 'text', text: nativeText }, image], display: true, details: { names: ['adventure'] } },
  ]));
  const restored = buildSessionContext(entries).messages;
  assert.equal(restored[0].role, 'user');
  assert.equal(restored[0].content[0].text, envelope);
  assert.equal(restored[1].role, 'custom');
  const llm = messages.convertToLlm(restored);
  assert.equal(llm[1].role, 'user');
  assert.deepEqual(llm[1].content, [{ type: 'text', text: nativeText }, image]);
  assert.equal('details' in llm[1], false);
  assert.equal(buildSessionContext(entries, 'a').messages.length, 1);
});

test('actual compaction projection keeps retained snapshots and drops summarized snapshots', () => {
  const entries = [
    { id: 'a', parentId: null, type: 'message', message: { role: 'user', content: envelope, timestamp: 1 } },
    { id: 'b', parentId: 'a', type: 'message', message: { role: 'user', content: 'kept task', timestamp: 2 } },
    { id: 'c', parentId: 'b', type: 'compaction', timestamp: '2026-09-20T00:00:00Z', summary: 'fixture summary', tokensBefore: 100, firstKeptEntryId: 'a' },
  ];
  assert.equal(buildSessionContext(entries).messages[1].content, envelope);
  entries[2].firstKeptEntryId = 'b';
  assert.equal(buildSessionContext(entries).messages.some(message => message.content === envelope), false);
});

test('actual custom conversion preserves user payload while custom sending skips prompt preparation', async () => {
  const h = host();
  await h.sendCustomMessage({ customType: 'review-fixture', content: [{ type: 'text', text: nativeText }, image], display: true, details: { names: ['adventure'] } }, { triggerTurn: true });
  const sent = h.calls.find(call => call.kind === 'prompt').message;
  assert.equal(sent.role, 'custom');
  assert.deepEqual(messages.convertToLlm([sent])[0], { role: 'user', content: [{ type: 'text', text: nativeText }, image], timestamp: sent.timestamp });
  assert.equal(h.calls.filter(call => call.kind === 'before_agent_start').length, 0);
});

test('actual custom queues bypass the user queue display and text recovery bookkeeping', async () => {
  const h = host();
  h.isStreaming = true;
  for (const deliverAs of ['steer', 'followUp']) {
    await h.sendCustomMessage({ customType: 'review-fixture', content: nativeText, display: true }, { triggerTurn: true, deliverAs });
    assert.equal(h.calls.find(call => call.kind === deliverAs).message.role, 'custom');
  }
  assert.deepEqual(h._steeringMessages, []);
  assert.deepEqual(h._followUpMessages, []);
  assert.equal(h.calls.filter(call => call.kind === 'queue_update').length, 0);
  assert.deepEqual(h.clearQueue(), { steering: [], followUp: [] });
});
