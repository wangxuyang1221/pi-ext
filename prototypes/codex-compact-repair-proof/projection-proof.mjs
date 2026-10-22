import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import {
  host, model, native, createSessionCoordinator, hashes, work, declaration, definition,
  system, user, assistant, checkpoint, itemUser, payload, sdk, wire,
} from './support.mjs';

const names = p => [...(p.tools ?? []), ...p.input.filter(item => ['additional_tools', 'tool_search_output'].includes(item.type))
  .flatMap(item => item.tools)].map(tool => tool.name);

function seed() {
  const sm = host.SessionManager.inMemory(work);
  sm.appendModelChange(model.provider, model.id);
  sm.appendThinkingLevelChange('medium');
  sm.appendMessage(system('Fixed prompt', { toolsAdded: [declaration('hider'), declaration('victim')] }));
  const kept = sm.appendMessage(user('same text'));
  sm.appendMessage(assistant([{ type: 'text', text: 'old answer' }]));
  sm.appendCompaction('ordinary summary', kept, 100, checkpoint());
  sm.appendMessage(system('additional instruction', { toolsAdded: [declaration('late')] }));
  sm.appendMessage(user('same text'));
  return sm;
}

// This finite oracle is deliberately restricted: known hidden/forced projection rules,
// no arbitrary context edits or payload rewriting, no pending tool group crossing the cut.
// It is not a proposed production algorithm (enumeration is exponential in tool names).
async function candidates(projected, actual, checkpointIndex, sourceIndexById) {
  const universe = [...new Set(projected.flatMap(entry => entry.messages.flatMap(message =>
    (message.toolsAdded ?? []).map(tool => tool.name))).concat('never-declared'))];
  assert.ok(universe.length <= 5, 'The bounded oracle is only for a small declared universe');
  const matches = [];
  for (let mask = 0; mask < 2 ** universe.length; mask++) {
    const hidden = new Set(universe.filter((_name, index) => mask & 2 ** index));
    for (const forced of [false, true]) {
      let trace = projected.flatMap(entry => entry.messages.filter(message => message.role !== 'compactionSummary')
        .map(message => ({ message: structuredClone(message), source: entry.sourceEntry.id })));
      trace = trace.map(row => {
        if (row.message.role !== 'system') return row;
        const { toolsAdded, toolsRemoved, ...rest } = row.message;
        const added = toolsAdded?.filter(tool => !hidden.has(tool.name)) ?? [];
        const removed = toolsRemoved?.filter(tool => !hidden.has(tool.name)) ?? [];
        return { ...row, message: { ...rest, ...(added.length ? { toolsAdded: added } : {}), ...(removed.length ? { toolsRemoved: removed } : {}) } };
      });
      if (forced) {
        const current = (await import('@earendil-works/pi-ai')).getCurrentSystemMessage(trace.map(row => row.message));
        trace = [{ source: projected[0].sourceEntry.id,
          message: system(actual.instructions, { ...(current?.toolsAdded ? { toolsAdded: current.toolsAdded } : {}) }) },
        ...trace.filter(row => row.message.role !== 'system')];
      }
      const p = await payload(trace.map(row => row.message));
      if (!isDeepStrictEqual(wire(p), wire(actual))) continue;
      // In this fixture, a prefix ending before the checkpoint has no open tool calls.
      // Verify the complete prefix instead of guessing a cut from user text matches.
      const before = trace.filter(row => sourceIndexById.get(row.source) <= checkpointIndex);
      const prefix = await payload(before.map(row => row.message));
      assert.deepEqual(p.input.slice(0, prefix.input.length), prefix.input);
      const suffix = p.input.slice(prefix.input.length);
      matches.push({ hidden: [...hidden], forced, suffix,
        replay: [{ type: 'compaction', encrypted_content: 'offline-opaque' }, ...suffix] });
    }
  }
  return matches;
}

export async function prove(record) {
  const initial = seed();
  const seedEntries = [initial.getHeader(), ...initial.getBranch()];
  const observations = [];
  for (const hidden of [false, true]) {
    let compactObservation;
    const sm = host.SessionManager.inMemory(work, undefined, structuredClone(seedEntries));
    const h = await sdk({ seed: sm, factories: [pi => {
      pi.registerTool(definition('victim'));
      pi.registerTool(definition('late'));
      pi.registerTool(definition('hider', { prepareLoadout: () => ({ hiddenDeclarations: hidden ? ['victim', 'late'] : [] }) }));
      pi.on('context_with_system', event => ({ messages: event.messages.filter(message => message.role !== 'compactionSummary') }));
      pi.on('session_before_compact', (event, ctx) => {
        compactObservation = { tools: pi.getAllTools(), active: pi.getActiveTools(), prompt: ctx.getSystemPrompt(),
          branch: ctx.sessionManager.getBranch(), preparation: event.preparation, payloads: h.observations.payloads.length };
        return { cancel: true };
      });
    }] });
    try {
      await assert.rejects(h.session.compact(), /Compaction cancelled/);
      observations.push(compactObservation);
      assert.equal(compactObservation.payloads, 0);
      await h.session.prompt('continue');
      assert.equal(names(h.observations.payloads[0]).includes('victim'), !hidden);
      record(`P4-first-manual-${hidden ? 'hidden' : 'visible'}`, { payloadsAtManual: 0, declarationNamesAtRequest: names(h.observations.payloads[0]) });
    } finally { await h.close(); }
  }
  assert.deepEqual(observations[0], observations[1]);
  record('P4-indistinguishable-manual', { observationsIdentical: true, laterPayloadsDiffer: true,
    scope: 'Ordinary public compact observations; arbitrary private loadout closure, no prior request.' });

  for (const mode of ['hidden', 'forced', 'both']) {
    const sm = seed();
    let capturedBranch;
    const h = await sdk({ seed: sm, factories: [pi => {
      pi.registerTool(definition('victim'));
      pi.registerTool(definition('late'));
      pi.registerTool(definition('hider', { prepareLoadout: () => ({ hiddenDeclarations: mode === 'forced' ? [] : ['victim', 'late'] }) }));
      pi.on('context_with_system', event => ({ messages: event.messages.filter(message => message.role !== 'compactionSummary') }));
      if (mode !== 'hidden') pi.on('before_agent_start', () => ({ systemPrompt: 'Forced prompt' }));
      pi.on('before_provider_request', (_event, ctx) => { capturedBranch = structuredClone(ctx.sessionManager.getBranch()); });
    }] });
    try {
      await h.session.prompt('continue');
      const actual = h.observations.payloads[0];
      const cpIndex = capturedBranch.findLastIndex(entry => entry.type === 'compaction');
      const projected = host.buildSessionProjection(capturedBranch, capturedBranch.at(-1).id).entries;
      const sourceIndices = new Map(capturedBranch.map((entry, index) => [entry.id, index]));
      const compatible = await candidates(projected, actual, cpIndex, sourceIndices);
      assert.ok(compatible.length >= 2, 'An irrelevant hidden name should leave several compatible policies');
      for (const candidate of compatible) assert.deepEqual(candidate.replay, compatible[0].replay);
      assert.equal(compatible[0].suffix.filter(item => item.role === 'user' && item.content[0].text === 'same text').length, 1);
      assert.equal(compatible[0].replay[0].encrypted_content, 'offline-opaque');
      const badBody = structuredClone(actual);
      const oldUser = badBody.input.find(item => item.role === 'user');
      oldUser.content[0].text = 'tampered history';
      assert.equal((await candidates(projected, badBody, cpIndex, sourceIndices)).length, 0);
      const badTool = structuredClone(actual);
      assert.ok(badTool.tools?.length);
      badTool.tools[0].description = 'unauthorized changed description';
      assert.equal((await candidates(projected, badTool, cpIndex, sourceIndices)).length, 0);
      const missingUser = structuredClone(actual);
      missingUser.input.splice(missingUser.input.findIndex(item => item.role === 'user'), 1);
      assert.equal((await candidates(projected, missingUser, cpIndex, sourceIndices)).length, 0);
      const reordered = structuredClone(actual);
      const userIndex = reordered.input.findIndex(item => item.role === 'user');
      const assistantIndex = reordered.input.findIndex(item => item.role === 'assistant');
      assert.ok(assistantIndex >= 0);
      [reordered.input[userIndex], reordered.input[assistantIndex]] = [reordered.input[assistantIndex], reordered.input[userIndex]];
      assert.equal((await candidates(projected, reordered, cpIndex, sourceIndices)).length, 0);
      const coordinator = createSessionCoordinator({ getBranch: () => capturedBranch, getAllTools: () => h.api.getAllTools(),
        resolveCompactionHashes: async () => hashes, createCheckpoint: async () => { throw new Error('Unexpected remote call'); },
        appendCheckpoint() {}, appendCheckpointBypass() {} });
      await assert.rejects(coordinator.prepareRequest(model, h.context(), actual.input, actual), error => error.name === 'HistoryPrefixMismatchError');
      record(`P4-equivalent-replay-${mode}`, { compatiblePolicies: compatible.length, distinctReplays: 1,
        suffixUserTexts: compatible[0].suffix.filter(item => item.role === 'user').map(item => item.content[0].text),
        negativeBodyAccepted: false, negativeToolAccepted: false, negativeDeletionAccepted: false, negativeReorderAccepted: false,
        originalCoordinatorRejected: true, scope: 'Bounded known projection family, monotonic tools, no crossing tool group.' });
    } finally { await h.close(); }
  }

  // Identical wire data cannot recover source provenance removed by arbitrary context hooks.
  const sm = host.SessionManager.inMemory(work);
  const beforeId = sm.appendMessage(user('identical'));
  sm.appendCustomEntry(native.NATIVE_COMPACTION_KIND, checkpoint());
  const afterId = sm.appendMessage(user('identical'));
  const branch = sm.getBranch();
  const hooked = async index => {
    const runner = new host.ExtensionRunner([{ path: 'proof-source-selector', handlers: new Map([
      ['context_with_system', [event => {
        const users = event.messages.filter(message => message.role === 'user');
        return { messages: [system('fixed'), users[index]] };
      }]],
    ]) }], {}, work, sm, {});
    runner.createContext = () => ({ sessionManager: sm, cwd: work });
    const errors = [];
    runner.onError(error => errors.push(error));
    const transformed = await runner.emitContext([system('fixed'), ...branch.filter(entry => entry.type === 'message').map(entry => entry.message)]);
    assert.equal(errors.length, 0);
    return payload(transformed);
  };
  const pBefore = await hooked(0);
  const pAfter = await hooked(1);
  assert.deepEqual(wire(pBefore), wire(pAfter));
  const replayBefore = checkpoint().replacementHistory;
  const replayAfter = [...checkpoint().replacementHistory, itemUser('identical')];
  assert.notDeepEqual(replayBefore, replayAfter);
  record('P4-arbitrary-hook-ambiguity', { sameBranch: true, sameWire: true, distinctReplays: 2,
    beforeSource: 'before-checkpoint', afterSource: 'after-checkpoint',
    scope: 'Real ExtensionRunner hooks select one of two identical messages across the checkpoint; outside known hidden/forced projection family.' });

  // A declaration policy can change while a provider event is awaiting, without changing its raw branch.
  let hidden = false, changed = false, snapshotEvidence;
  const h = await sdk({ seed: seed(), factories: [pi => {
    pi.registerTool(definition('victim'));
    pi.registerTool(definition('late'));
    pi.registerTool(definition('hider', { prepareLoadout: () => ({ hiddenDeclarations: hidden ? ['victim'] : [] }) }));
    pi.on('before_provider_request', async (event, ctx) => {
      if (changed) return;
      changed = true;
      const request = structuredClone(event.payload);
      const before = structuredClone(ctx.sessionManager.getBranch());
      const toolsBefore = structuredClone(pi.getAllTools());
      await Promise.resolve();
      hidden = true;
      pi.registerTool(definition('hider', { description: 'changed during await',
        prepareLoadout: () => ({ hiddenDeclarations: ['victim'] }) }));
      assert.deepEqual(ctx.sessionManager.getBranch(), before);
      assert.notDeepEqual(pi.getAllTools(), toolsBefore);
      assert.deepEqual(event.payload, request);
      snapshotEvidence = { branchUnchanged: true, liveToolsChanged: true, capturedPayloadUnchanged: true,
        oldPayloadStillDeclaresVictim: names(request).includes('victim') };
    });
  }] });
  try {
    await h.session.prompt('capture then change');
    await h.session.prompt('observe next request');
    assert.ok(names(h.observations.payloads[0]).includes('victim'));
    assert.ok(!names(h.observations.payloads[1]).includes('victim'));
    record('P4-await-snapshot', { ...snapshotEvidence, nextPayloadDeclaresVictim: false });
  } finally { await h.close(); }
}
