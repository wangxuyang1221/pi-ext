import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mock } from 'node:test';
import ts from 'typescript';
import {
  repo, work, network, host, prepareCompaction, model, native, createSessionCoordinator, compactExtension,
  createBranchProjectionSnapshot, hashes, transformMessages, apiKey,
  declaration, definition, user, system, assistant, toolCall, result, entries,
  itemUser, checkpoint, payload, sdk, wire, wireKinds, json,
} from './support.mjs';

const records = [];
const record = (id, evidence) => {
  const row = { id, ...evidence };
  records.push(row);
  console.log(JSON.stringify(row));
};
const normalize = value => json(value);
const convert = (messages, selected = model, tools = []) => native.fullInputForBranch({ branch: entries(messages), model: selected, tools });

// Candidate 1 uses the real compaction projection, retaining source IDs and the system baseline.
for (const shape of ['native', 'ordinary-then-custom', 'overlap']) {
  const sm = host.SessionManager.inMemory(work);
  sm.appendMessage(system('', { sections: { rules: 'Old rules' } }));
  sm.appendMessage(user('earlier'.repeat(2000)));
  sm.appendMessage(assistant([{ type: 'text', text: 'earlier answer' }]));
  const kept = sm.appendMessage(user('retained'.repeat(600)));
  sm.appendMessage(system('', { sections: { rules: 'New rules' } }));
  sm.appendMessage(user('also retained'));
  const preparation = prepareCompaction(sm.getBranch(), { enabled: true, reserveTokens: 1, keepRecentTokens: 1000 });
  assert.ok(preparation);
  assert.equal(preparation.firstKeptEntryId, kept);
  sm.appendCompaction('summary', kept, preparation.tokensBefore, shape === 'native' ? checkpoint() : undefined);
  if (shape === 'overlap') sm.appendCompaction('new summary', kept, preparation.tokensBefore);
  if (shape !== 'native') sm.appendCustomEntry(native.NATIVE_COMPACTION_KIND, checkpoint());
  sm.appendMessage(user('continue'));
  const expectedMessages = sm.buildSessionProjection().messages.filter(message => message.role !== 'compactionSummary');
  const expected = (await payload(expectedMessages)).input;
  const old = native.piContextInputForBranch({ branch: sm.getBranch(), model, tools: [] });
  const projected = createBranchProjectionSnapshot(sm.getBranch()).piContext();
  const candidate = projected.flatMap(entry => entry.messages.filter(message => message.role !== 'compactionSummary'));
  assert.notDeepEqual(normalize(old), normalize(expected));
  assert.deepEqual(normalize(convert(candidate)), normalize(expected));
  assert.deepEqual(candidate[0], sm.buildSessionProjection().messages[0]);
  const sourceIds = projected.filter(entry => entry.messages.some(message => message.role === 'user')).map(entry => entry.sourceEntry.id);
  assert.equal(sourceIds[0], kept);
  const tracedBranch = projected.flatMap(entry => entry.messages.filter(message => message.role !== 'compactionSummary')
    .map(message => ({ ...entry.sourceEntry, type: 'message', message })));
  const traced = native.createBranchInputSnapshot({ branch: tracedBranch, tools: [] }).view(model, 'full-history');
  assert.deepEqual([...traced.userSources.values()], sourceIds);
  assert.deepEqual(normalize(traced.items), normalize(expected));
  record(`P1-${shape}`, { original: wireKinds(old), candidate: wireKinds(expected), sourceCount: sourceIds.length,
    baselinePreserved: true, candidateUserSourcesMatch: true });
}

{
  const sm = host.SessionManager.inMemory(work);
  const kept = sm.appendMessage(user('retained ordinary history'));
  sm.appendCompaction('ordinary summary must remain', kept, 100);
  sm.appendMessage(user('continue'));
  const expected = (await payload(sm.buildSessionProjection().messages)).input;
  const actual = native.piContextInputForBranch({ branch: sm.getBranch(), model, tools: [] });
  assert.deepEqual(normalize(actual), normalize(expected));
  assert.ok(JSON.stringify(actual).includes('ordinary summary must remain'));
  record('P1-ordinary-summary-control', { ordinarySummaryPreserved: true });
}

// Candidate 2 delegates ordering to Pi's public transformer before local serialization.
for (const shape of ['orphan', 'real-result', 'parallel-partial', 'two-system-updates']) {
  for (const toolSearch of [false, true]) {
    const selected = { ...model, compat: { ...model.compat, supportsAdditionalTools: !toolSearch, supportsToolSearch: toolSearch } };
    const messages = [system('head', { toolsAdded: [declaration('read')] }), user('task'),
      assistant([toolCall(), ...(shape === 'parallel-partial' ? [toolCall('read', 'other|fc_other')] : [])], 'toolUse'),
      system('updated', { toolsAdded: [declaration('late')] })];
    if (shape !== 'orphan') messages.push(result());
    if (shape === 'two-system-updates') messages.push(system('updated again', { toolsAdded: [declaration('later')] }));
    messages.push(user('continue'), assistant([{ type: 'text', text: 'answer' }]));
    const expected = (await payload(messages, selected)).input;
    const old = convert(messages, selected);
    const ordered = transformMessages(messages, selected);
    const candidate = convert(ordered, selected);
    assert.notDeepEqual(normalize(old), normalize(expected));
    assert.deepEqual(normalize(candidate), normalize(expected));
    assert.equal(candidate.filter(item => item.type === 'function_call_output' && item.call_id === 'call').length, 1);
    record(`P2-${shape}-${toolSearch ? 'search' : 'additional'}`, { original: wireKinds(old), candidate: wireKinds(candidate), exactIdsMatch: true });
  }
}

// Candidate 5 is an isolated one-condition edit; production files remain unchanged.
const originalSource = readFileSync(resolve(repo, 'extensions/codex-compact/src/native-compaction.ts'), 'utf8');
const oldCondition = 'if ((sameProviderApi && !sameModel && itemId?.startsWith("fc_")) || (!custom && !itemId?.startsWith("fc_"))) itemId = undefined;';
assert.equal(originalSource.split(oldCondition).length, 2);
const candidateSource = originalSource.replace(oldCondition,
  'if ((sameProviderApi && !sameModel) || !itemId?.startsWith(custom ? "ctc_" : "fc_")) itemId = undefined;');
const candidateJs = ts.transpileModule(candidateSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace(/from "(\.\/[^\"]+)"/g, (_match, name) => `from ${JSON.stringify(pathToFileURL(resolve(repo, 'extensions/codex-compact/dist', name)).href)}`);
const candidatePath = resolve(work, 'grammar-candidate.mjs');
writeFileSync(candidatePath, candidateJs);
const grammarCandidate = await import(pathToFileURL(candidatePath).href);
const grammar = { ...declaration('edit'), parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
  constrainedSampling: { type: 'grammar', variants: { openai_regex: '.*' } } };
const grammarModel = { ...model, compat: { ...model.compat, supportsOpenAIGrammarTools: true } };
for (const shape of ['foreign-fc', 'same-model-fc', 'cross-model-ctc', 'same-model-ctc']) {
  const sourceModel = shape === 'foreign-fc' ? { ...grammarModel, provider: 'foreign', api: 'foreign' }
    : shape === 'cross-model-ctc' ? { ...grammarModel, id: 'other-model' } : grammarModel;
  const id = `call|${shape.endsWith('ctc') ? 'ctc_' : 'fc_'}item`;
  const messages = [user('edit'), assistant([{ type: 'toolCall', id, name: 'edit', arguments: { input: 'hello' } }], 'toolUse', sourceModel), result(id, 'edit')];
  const p = await payload(messages, grammarModel, [grammar]);
  assert.equal(p.input.find(item => item.name === 'edit').type, 'custom_tool_call');
  const tools = native.toolsWithRequestFormats([grammar], p, p.input);
  const old = convert(messages, grammarModel, tools);
  const candidate = grammarCandidate.fullInputForBranch({ branch: entries(messages), model: grammarModel, tools });
  assert.deepEqual(normalize(candidate), normalize(p.input));
  if (shape === 'same-model-ctc' || shape === 'cross-model-ctc') assert.deepEqual(normalize(old), normalize(p.input));
  else assert.notDeepEqual(normalize(old), normalize(p.input));
  record(`P5-${shape}`, { oldId: old.find(item => item.name === 'edit').id ?? null,
    candidateId: candidate.find(item => item.name === 'edit').id ?? null, callId: candidate.find(item => item.name === 'edit').call_id });
}

// Exercise the actual compaction handler with Pi's actual preparation and offline HTTP bodies.
const blockedFetch = globalThis.fetch;
for (const reason of ['manual', 'threshold', 'overflow']) {
  const sm = host.SessionManager.inMemory(work);
  sm.appendMessage(user('completed earlier task'));
  sm.appendMessage(assistant([{ type: 'text', text: 'earlier answer' }]));
  sm.appendMessage(user('x'.repeat(280_000)));
  if (reason !== 'overflow') sm.appendMessage(assistant([{ type: 'text', text: 'completed large task' }]));
  const preparation = prepareCompaction(sm.getBranch(), { enabled: true, reserveTokens: 1, keepRecentTokens: 1 });
  assert.ok(preparation);
  const handlers = new Map();
  compactExtension({ on: (name, handler) => handlers.set(name, handler), registerCommand() {}, getAllTools: () => [], getActiveTools: () => [], appendEntry() {} });
  const remoteBodies = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/models?')) return Response.json({ models: [] });
    assert.ok(String(url).endsWith('/codex/responses'), 'Only offline compaction endpoint is expected');
    remoteBodies.push(JSON.parse(init.body));
    return new Response('data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"offline-new"}}\n\n'
      + 'data: {"type":"response.completed","response":{"id":"offline"}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const ctx = { cwd: work, isProjectTrusted: () => true, hasUI: false, ui: { notify() {}, setStatus() {}, setWidget() {} },
      model, thinkingLevel: 'off', sessionManager: sm, getSystemPrompt: () => 'Fixed prompt',
      modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey, headers: {}, baseUrl: 'https://offline.test/backend-api' }), find: () => model } };
    const output = await handlers.get('session_before_compact')({ preparation, branchEntries: sm.getBranch(), reason,
      willRetry: reason === 'overflow', signal: new AbortController().signal }, ctx);
    assert.ok(output?.compaction, JSON.stringify(output));
    assert.equal(remoteBodies.length, 1);
    const before = remoteBodies[0].input.filter(item => item.type !== 'compaction_trigger');
    const after = [...output.compaction.details.replacementHistory, ...(output.compaction.details.preservedInput ?? [])];
    const lengths = after.filter(item => item.role === 'user').map(item => item.content[0].text.length);
    assert.ok(lengths.includes(280_000));
    assert.ok(lengths.some(length => length > 250_000 && length < 280_000));
    record(`P3-${reason}`, { beforeTokens: native.approximateResponseItemTokens(before), afterTokens: native.approximateResponseItemTokens(after), userLengths: lengths });
  } finally { globalThis.fetch = blockedFetch; }
}

// Identical text is not identity; prototype retention excludes by provenance before truncation.
const sameText = 'x'.repeat(280_000);
const occurrences = [{ source: 'completed-A', item: itemUser(sameText) }, { source: 'pending-B', item: itemUser(sameText) }];
const protectedIds = new Set(['pending-B']);
const retention = native.retainRecentMessages(occurrences.filter(row => !protectedIds.has(row.source)).map(row => row.item));
const preserved = occurrences.filter(row => protectedIds.has(row.source)).map(row => row.item);
assert.equal(retention.length, 1);
assert.equal(preserved.length, 1);
assert.equal(preserved[0].content[0].text.length, 280_000);
assert.ok(retention[0].content[0].text.length < 280_000);
record('P3-source-identity', { differentOccurrencesKept: true, pendingFullCopies: 1,
  note: 'The retained truncated A and full B are different source occurrences, not a duplicate.' });

// A fresh large user bypasses the current no-tail auto-compaction gate.
{
  const small = { ...model, contextWindow: 128_000 };
  const sm = host.SessionManager.inMemory(work);
  const retained = itemUser('a'.repeat(255_900));
  const opaque = { type: 'compaction', encrypted_content: 'offline-opaque' };
  sm.appendMessage(user('a'.repeat(255_900)));
  sm.appendCustomEntry(native.NATIVE_COMPACTION_KIND, checkpoint(small, [retained, opaque]));
  sm.appendMessage(user('b'.repeat(280_000)));
  const p = await payload(sm.buildSessionProjection().messages, small);
  let decisions = 0, remoteCalls = 0;
  const coordinator = createSessionCoordinator({ resolveCompactionHashes: async () => hashes, getBranch: () => sm.getBranch(),
    getAllTools: () => [], shouldAutoCompact: () => { decisions++; return true; },
    createCheckpoint: async () => { remoteCalls++; throw new Error('Unexpected compaction'); }, appendCheckpoint() {}, appendCheckpointBypass() {} });
  const ctx = { cwd: work, model: small, getSystemPrompt: () => '', sessionManager: sm, modelRegistry: { find: () => small } };
  const replay = await coordinator.prepareRequest(small, ctx, p.input, p);
  assert.equal(decisions, 0);
  assert.equal(remoteCalls, 0);
  const finalTokens = native.approximateCompactionRequestTokens({ input: replay, instructions: p.instructions, tools: p.tools });
  assert.ok(finalTokens > small.contextWindow);
  const current = itemUser('b'.repeat(280_000));
  const prefixTokens = native.approximateCompactionRequestTokens({ input: [], instructions: p.instructions, tools: p.tools });
  const budget = Math.max(0, Math.min(64_000, Math.floor(small.contextWindow * .95) - prefixTokens
    - native.approximateResponseItemTokens([opaque, current])));
  const smaller = [...native.retainRecentMessages([retained], budget), opaque, current];
  const smallerTokens = native.approximateCompactionRequestTokens({ input: smaller, instructions: p.instructions, tools: p.tools });
  assert.ok(smallerTokens < finalTokens);
  const target = Math.floor(small.contextWindow * .95);
  assert.ok(smallerTokens > target, 'The naive retention formula does not cover wire/truncation overhead');
  const checkedBudget = Math.max(0, budget - (smallerTokens - target));
  const checked = [...native.retainRecentMessages([retained], checkedBudget), opaque, current];
  const checkedTokens = native.approximateCompactionRequestTokens({ input: checked, instructions: p.instructions, tools: p.tools });
  assert.ok(checkedTokens <= target);
  assert.equal(smaller.at(-1).content[0].text, current.content[0].text);
  record('P6-complete-budget', { window: small.contextWindow, effectiveWindow: Math.floor(small.contextWindow * .95),
    decisions, remoteCalls, finalTokens, candidateRetentionBudget: budget, candidateTokens: smallerTokens,
    naiveExcess: smallerTokens - target, checkedRetentionBudget: checkedBudget, checkedTokens,
    oldTextBefore: retained.content[0].text.length, oldTextAfter: checked[0].content[0].text.length,
    caveat: 'Local arithmetic only; no server tokenizer or encrypted-summary quality claim.' });
}

// A stalled error body outlives the fetch timeout. Always release it after observing the defect.
{
  mock.timers.enable({ apis: ['setTimeout'] });
  let bodyController, done = false, calls = 0;
  const controller = new AbortController();
  const completion = native.callRemoteCompaction({ url: 'https://offline.test', headers: new Headers(), body: {}, model,
    signal: controller.signal, fetchImpl: async (_url, init) => {
      calls++;
      return new Response(new ReadableStream({ start(c) {
        bodyController = c;
        init.signal.addEventListener('abort', () => c.error(new Error('Aborted offline stream')), { once: true });
      } }), { status: 503 });
    } }).then(() => { done = true; }, () => { done = true; });
  for (let index = 0; index < 20; index++) await Promise.resolve();
  mock.timers.tick(1_000_000);
  for (let index = 0; index < 20; index++) await Promise.resolve();
  assert.equal(done, false);
  assert.equal(calls, 1);
  record('P7-stalled-error-body', { fakeElapsedMs: 1_000_000, settled: done, attempts: calls });
  controller.abort();
  await completion;
  assert.equal(done, true);
  assert.ok(bodyController);
  mock.timers.reset();
}

// SDK evidence: stop is a response boundary, not necessarily the end of the run.
{
  let continued = false;
  const h = await sdk({ factories: [pi => {
    pi.on('agent_before_settle', () => {
      if (continued) return;
      continued = true;
      return { entries: [{ type: 'custom_message', customType: 'proof-next', content: 'Continue the same task', display: false }], continue: true };
    });
  }] });
  try {
    await h.session.prompt('Finish a task that needs continuation');
    assert.equal(h.observations.requests, 2);
    assert.deepEqual(h.manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'assistant').map(entry => entry.message.stopReason), ['stop', 'stop']);
    assert.equal(h.observations.errors.length, 0);
    record('P3-stop-then-continuation', { requests: h.observations.requests, events: h.observations.events });
  } finally { await h.close(); }
}

// The remaining host-projection probes share this exact run and network guard.
await import('./projection-proof.mjs').then(module => module.prove(record));
await import('./error-body-proof.mjs').then(module => module.prove(record));

assert.equal(network.unexpected, 0);
const evidence = { schemaVersion: 1, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  node: process.version, platform: process.platform, pi: '1.3.0', unexpectedNetwork: network.unexpected, cases: records.length, records };
writeFileSync(resolve(work, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ id: 'complete', cases: records.length, unexpectedNetwork: network.unexpected,
  evidence: '.tmp/codex-compact-repair-proof/evidence.json' }));
