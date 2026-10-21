import { truncateToWidth, visibleWidth, wrapTextWithAnsi, stripTerminalSequences } from '@earendil-works/pi-tui';

export function renderInspector(row, { theme, width, height = 24, selected = 0, tab = 'Calls', scroll = 0, nativeChild } = {}) {
  const fit = line => truncateToWidth(line, Math.max(0, width), '…');
  const heading = [theme.bold(`Codemode inspector · ${row.status}`), ['Calls', 'Script', 'Output'].map(name => name === tab ? `[${name}]` : name).join('  ')];
  let body;
  if (tab !== 'Calls') body = clean(tab === 'Script' ? row.code : row.output || '(No output)').split('\n').flatMap(line => wrapTextWithAnsi(line, Math.max(1, width)));
  else {
    const call = row.calls[selected];
    const details = call ? [label(call), `Status: ${call.status} · ${duration(call.durationMs)}`, `Started: +${duration(call.startMs) || 'unknown'}`, ...clean(JSON.stringify(call.args, null, 2)).split('\n'), ...(nativeChild?.(call, width, true, theme) ?? clean(call.result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || call.error || 'Raw result unavailable').split('\n'))] : ['No calls'];
    if (width >= 90) {
      const leftWidth = Math.floor(width * 0.40);
      const rightWidth = width - leftWidth - 3;
      const available = Math.max(1, height - 4);
      const start = Math.max(0, selected - available + 1);
      const left = row.calls.slice(start, start + available).map((item, index) => `${start + index === selected ? '>' : ' '} ${mark(item.status)} ${label(item)}`);
      const right = details.flatMap(line => wrapTextWithAnsi(line, rightWidth)).slice(scroll);
      body = Array.from({ length: Math.max(left.length, Math.min(right.length, available)) }, (_, i) => {
        const a = truncateToWidth(left[i] ?? '', leftWidth, '…');
        return a + ' '.repeat(Math.max(0, leftWidth - visibleWidth(a))) + ' │ ' + (right[i] ?? '');
      });
    } else body = details.flatMap(line => wrapTextWithAnsi(line, Math.max(1, width))).slice(scroll);
  }
  if (tab !== 'Calls') body = body.slice(scroll);
  return [...heading, ...body.slice(0, Math.max(0, height - 4)), theme.fg('dim', 'Tab: view · ↑↓: call · PgUp/PgDn: scroll'), theme.fg('dim', 'Esc: close')].slice(0, Math.max(1, height)).map(fit);
}

export const LAYOUTS = ['Compact', 'Call tree', 'Flat stream', 'Inspector', 'Outcome first', 'Hybrid'];
export const clean = value => stripTerminalSequences(String(value ?? '')).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '');
export const duration = ms => ms === undefined ? '' : `${(ms / 1000).toFixed(1)}s`;
const inline = value => clean(value).replace(/\s+/gu, ' ').trim();
export const label = call => inline(`${call.name} ${call.args?.path ?? call.args?.command ?? JSON.stringify(call.args ?? {})}`);
const failed = call => call.status === 'error' || call.status === 'cancelled';
const color = status => status === 'error' || status === 'failed' ? 'error' : ['running', 'pending', 'cancelled', 'interrupted', 'timed_out'].includes(status) ? 'warning' : 'muted';
const mark = status => status === 'running' ? '●' : failed({ status }) ? '×' : '✓';

export function renderRow(row, { layout = 6, expanded = false, theme, width = 80, nativeChild } = {}) {
  const calls = row.calls ?? [];
  const errors = calls.filter(failed);
  const running = calls.filter(call => call.status === 'running').length;
  const counts = `${calls.filter(call => call.status === 'ok').length} completed · ${running} running · ${errors.length} failed`;
  const state = { completed: 'Script completed', failed: 'Script failed', interrupted: 'Interrupted', timed_out: 'Timed out', running: 'Running', pending: 'Preparing' }[row.status] ?? row.status;
  const statusColor = errors.length && row.status === 'completed' ? 'warning' : color(row.status);
  const header = `${expanded ? '▾' : '▸'} Codemode · ${state}${row.durationMs === undefined ? '' : ` · ${duration(row.durationMs)}`} · ${layout} ${LAYOUTS[layout - 1]}`;
  const lines = [theme.fg(statusColor, theme.bold(header))];
  const warnings = () => {
    for (const call of errors) lines.push(theme.fg('warning', `  ! ${label(call)} · ${inline(call.error ?? call.status)}`));
    if (row.error) lines.push(theme.fg(color(row.status), `  ! ${inline(row.error)}`));
    if (row.complete === false) lines.push(theme.fg('warning', '  ! Incomplete history; some call details are unavailable'));
  };
  const output = () => {
    lines.push(theme.fg('dim', '  Output to model'));
    const payload = clean(row.output).replace(/^Script (?:completed|failed)\nWall time [^\n]+\n(?:\n)?Output:\n/u, '').replace(/^==> text \d+\/\d+ <==\n/gmu, '');
    const source = (payload || (row.status === 'running' ? 'Waiting for script output…' : '(No output)')).split('\n').filter(line => expanded || line.trim());
    for (const line of source.slice(0, expanded ? 16 : 2)) lines.push(`    ${line}`);
    if (source.length > (expanded ? 16 : 2)) lines.push(theme.fg('dim', '    … /inspect → Output for full fixture output'));
  };
  const children = (items = calls, tree = true) => {
    const shown = expanded ? items : items.slice(0, 5);
    for (const call of shown) {
      const prefix = tree ? '  ├─ ' : '  ';
      const native = (expanded || !tree) ? nativeChild?.(call, Math.max(1, width - 6), expanded, theme) : undefined;
      if (native?.length) {
        for (const [index, line] of native.entries()) lines.push(`${index === 0 ? prefix : '      '}${line}`);
      } else {
        lines.push(theme.fg(color(call.status), `${prefix}${mark(call.status)} ${label(call)} · ${call.status} ${duration(call.durationMs)}`));
        if (expanded || !tree) {
          const body = call.result?.content?.filter(item => item.type === 'text').flatMap(item => clean(item.text).split('\n')).slice(0, expanded ? 8 : 2) ?? [];
          for (const line of body) lines.push(`      ${line}`);
          if (!body.length && call.status !== 'running' && row.complete === false) lines.push(theme.fg('dim', '      Raw child result unavailable'));
        }
      }
    }
    if (shown.length < items.length) lines.push(theme.fg('dim', `  … ${items.length - shown.length} more calls · Ctrl+O to expand`));
  };
  const script = () => {
    lines.push(theme.fg('dim', '  Script · /inspect → Script for full source'));
    for (const line of clean(row.code).split('\n').slice(0, 8)) lines.push(theme.fg('dim', `    ${line}`));
  };
  if (layout === 1) {
    const types = [...new Set(calls.map(call => call.name))].map(name => `${name} ×${calls.filter(call => call.name === name).length}`).join(' · ');
    lines.push(theme.fg('dim', `  ${calls.length} calls · ${types || 'none'}`));
    warnings(); output();
    if (expanded) { children(); script(); }
  } else if (layout === 2) {
    lines.push(theme.fg('dim', `  Calls in start order · ${counts}`));
    children(); warnings(); output();
  } else if (layout === 3) {
    lines.push(theme.fg('dim', '  ┌ Native tool stream'));
    children(calls, false); warnings(); output();
    lines.push(theme.fg('dim', '  └ End of codemode group'));
  } else if (layout === 4) {
    lines.push(theme.fg('dim', '  Timeline · /inspect opens Calls / Script / Output'));
    for (const call of (expanded ? calls : calls.slice(0, 4))) {
      lines.push(theme.fg(color(call.status), `  +${duration(call.startMs) || '?'}  ${mark(call.status)} ${label(call)} · ${duration(call.durationMs) || 'running'}`));
    }
    if (!expanded && calls.length > 4) lines.push(theme.fg('dim', `  … ${calls.length - 4} more calls`));
    warnings(); output();
  } else if (layout === 5) {
    const mutations = calls.filter(call => ['edit', 'write'].includes(call.name));
    lines.push(theme.fg('dim', '  Changes · observed file tools only'));
    if (mutations.length) children(mutations, false);
    else lines.push(theme.fg('dim', '    No observed file-tool changes'));
    warnings(); output();
    const rest = calls.filter(call => !mutations.includes(call));
    if (expanded) children(rest);
    else lines.push(theme.fg('dim', `  ▸ ${rest.length} other calls · Ctrl+O to expand`));
  } else {
    lines.push(theme.fg('dim', `  ${calls.length} calls · ${counts}`));
    warnings();
    if (expanded) children();
    output();
    if (expanded) lines.push(theme.fg('dim', '  /inspect → Script to inspect source'));
  }
  return lines.map(line => truncateToWidth(line, Math.max(0, width), '…'));
}
