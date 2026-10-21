const contentText = result => (result?.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
const parseArgs = args => { if (typeof args !== 'string') return args ?? {}; try { return JSON.parse(args); } catch { return { preview: args }; } };

// Session-local evidence. Pi persists bounded call metadata, not raw child results.
export class CallStore {
  rows = new Map();
  listeners = new Set();
  ensure(id, code = '') {
    if (!this.rows.has(id)) this.rows.set(id, { id, code, status: 'pending', calls: [], complete: true, output: '' });
    const row = this.rows.get(id);
    if (code) row.code = code;
    return row;
  }
  get(id) { return this.rows.get(id); }
  latest() { return [...this.rows.values()].at(-1); }
  notify() { for (const listener of this.listeners) listener(); }
  mergeDetails(row, result) {
    for (const entry of result?.details?.calls ?? []) {
      // Pi publishes placeholder IDs before ctx.executeTool assigns a stable ID.
      if (entry.id.endsWith('/?')) continue;
      let call = row.calls.find(call => call.id === entry.id);
      if (!call) { call = { ...entry, args: parseArgs(entry.args) }; row.calls.push(call); }
      // Events contain the untruncated arguments and original result.
      Object.assign(call, { status: entry.status, durationMs: entry.durationMs ?? call.durationMs, error: entry.error ?? call.error });
    }
  }
  observe(event, now = Date.now()) {
    if (event.parentToolCallId) {
      const row = this.rows.get(event.parentToolCallId);
      if (!row) return;
      let call = row.calls.find(item => item.id === event.toolCallId);
      if (!call) {
        call = { id: event.toolCallId, name: event.toolName, args: event.args ?? {}, status: 'running', startedAt: now, startMs: row.startedAt === undefined ? undefined : now - row.startedAt };
        row.calls.push(call);
      }
      if (event.type === 'tool_execution_update') call.result = event.partialResult;
      if (event.type === 'tool_execution_end') {
        call.status = event.isError ? 'error' : 'ok';
        call.durationMs = now - call.startedAt;
        call.result = event.result;
        call.error = event.isError ? contentText(event.result) : undefined;
      }
    } else if (event.toolName === 'codemode') {
      const row = this.ensure(event.toolCallId, event.args?.code);
      if (event.type === 'tool_execution_start') { row.status = 'running'; row.startedAt = now; }
      if (event.type === 'tool_execution_update') {
        this.mergeDetails(row, event.partialResult);
        row.output = contentText(event.partialResult);
      }
      if (event.type === 'tool_execution_end') {
        row.status = row.stopRequested ? 'interrupted' : event.isError ? 'failed' : 'completed';
        row.durationMs = row.startedAt === undefined ? undefined : now - row.startedAt;
        row.output = contentText(event.result);
        this.mergeDetails(row, event.result);
        row.error = event.isError ? row.output.split('\n').filter(Boolean).at(-1) : undefined;
      }
    } else if (event.type === 'message_end' && event.message?.role === 'toolResult' && event.message.toolName === 'codemode') {
      const row = this.ensure(event.message.toolCallId);
      if (event.message.nestedCalls?.complete === false) row.complete = false;
    } else return;
    this.notify();
  }
  restore(id, code, result, isError) {
    const row = this.ensure(id, code);
    row.status = isError ? 'failed' : 'completed';
    row.output = contentText(result);
    row.complete = false;
    this.mergeDetails(row, result);
    return row;
  }
}
