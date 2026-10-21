import assert from 'node:assert/strict';
import test from 'node:test';
import { CallStore } from '../src/model.mjs';

test('nested events retain start order, raw results, and child failure when the parent succeeds', () => {
  const store = new CallStore();
  store.observe({ type: 'tool_execution_start', toolName: 'codemode', toolCallId: 'p', args: { code: 'text(1)' } }, 100);
  for (const id of ['a', 'b']) store.observe({ type: 'tool_execution_start', toolName: 'bash', parentToolCallId: 'p', toolCallId: id, args: { command: id } }, 120);
  store.observe({ type: 'tool_execution_end', toolName: 'bash', parentToolCallId: 'p', toolCallId: 'b', isError: true, result: { content: [{ type: 'text', text: 'Exit code 1' }] } }, 140);
  store.observe({ type: 'tool_execution_end', toolName: 'codemode', toolCallId: 'p', isError: false, result: { content: [{ type: 'text', text: 'Script completed\nOutput:\nhandled' }] } }, 160);
  const row = store.get('p');
  assert.equal(row.status, 'completed');
  assert.equal(row.output, 'Script completed\nOutput:\nhandled');
  assert.deepEqual(row.calls.map(call => call.id), ['a', 'b']);
  assert.equal(row.calls[1].status, 'error');
  assert.equal(row.calls[1].error, 'Exit code 1');
  assert.equal(row.calls[1].startMs, 20);
  assert.equal(row.calls[1].durationMs, 20);
});

test('temporary codemode /? records do not duplicate real nested calls', () => {
  const store = new CallStore();
  store.observe({ type: 'tool_execution_start', toolName: 'codemode', toolCallId: 'p', args: {} });
  store.observe({ type: 'tool_execution_update', toolName: 'codemode', toolCallId: 'p', partialResult: { details: { calls: [{ id: 'p/?', name: 'read', args: '{}', status: 'running' }] } } });
  store.observe({ type: 'tool_execution_start', toolName: 'read', parentToolCallId: 'p', toolCallId: 'p/1', args: {} });
  assert.deepEqual(store.get('p').calls.map(call => call.id), ['p/1']);
});

test('restored metadata stays explicitly incomplete and does not invent raw results or start times', () => {
  const store = new CallStore();
  const row = store.restore('p', 'text(1)', { content: [{ type: 'text', text: 'saved output' }], details: { calls: [{ id: 'p/1', name: 'read', args: '{"path":"package.json"}', status: 'ok', durationMs: 50 }] } }, false);
  assert.equal(row.complete, false);
  assert.equal(row.calls[0].result, undefined);
  assert.equal(row.calls[0].startMs, undefined);
  assert.equal(row.calls[0].args.path, 'package.json');
});
