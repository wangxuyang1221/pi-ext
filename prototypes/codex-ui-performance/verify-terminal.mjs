import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { TuiMainScreen } from '@earendil-works/pi-tui';
import { setTheme } from '@earendil-works/pi-coding-agent';
import { definitions, textResult, advance, outputDirectory } from './shared.mjs';

class CaptureTerminal {
  columns = 120;
  rows = 40;
  chunks = [];
  write(text) { this.chunks.push(text); }
  start() {}
  stop() {}
  hideCursor() {}
  showCursor() {}
  drainInput() {}
  moveBy() {}
  clearLine() {}
  clearFromCursor() {}
  setTitle() {}
  take() { const data = this.chunks.join(''); this.chunks = []; return data; }
}
function screenFor(terminal) {
  const screen = new TuiMainScreen(terminal, false, outputDirectory);
  screen.requestRender = () => {};
  screen.start();
  return screen;
}
function emulator(columns = 120) {
  return new xterm.Terminal({ cols: columns, rows: 40, scrollback: 10000, allowProposedApi: true, logLevel: 'off' });
}
async function feed(terminal, text) {
  if (text) await new Promise(resolve => terminal.write(Buffer.from(text), resolve));
}
function visibleGrid(terminal) {
  const buffer = terminal.buffer.active;
  return Array.from({ length: terminal.rows }, (_, y) => {
    const line = buffer.getLine(buffer.viewportY + y);
    return Array.from({ length: terminal.cols }, (_, x) => {
      const cell = line?.getCell(x);
      return cell && [cell.getChars(), cell.getWidth(), cell.getFgColorMode(), cell.getFgColor(),
        cell.getBgColorMode(), cell.getBgColor(), cell.isBold(), cell.isItalic(), cell.isUnderline()];
    });
  });
}
async function compareWithFresh(row, actual, columns, label) {
  const terminal = new CaptureTerminal();
  terminal.columns = columns;
  const screen = screenFor(terminal);
  const expected = emulator(columns);
  try {
    screen.addChild(row);
    screen.renderNow();
    await feed(expected, terminal.take());
    const expectedGrid = visibleGrid(expected);
    const actualGrid = visibleGrid(actual);
    for (let index = 0; index < 40; index++) assert.deepEqual(actualGrid[index], expectedGrid[index], `${label}/row-${index}`);
  } finally { screen.stop(); expected.dispose(); }
}

export async function verifyTerminal() {
  const results = [];
  for (const shape of ['short', 'token']) for (const history of [0, 20]) for (const groupSize of [1, 3]) {
    setTheme('dark', false);
    const owner = definitions('after');
    const terminal = new CaptureTerminal();
    const screen = screenFor(terminal);
    const parsed = emulator();
    try {
      for (let index = 0; index < history; index++) {
        const row = owner.row('bash', { command: `history-${index}` }, screen);
        row.setExpanded(true);
        row.updateResult(textResult('offscreen-history-marker\n'.repeat(1800)));
        screen.addChild(row);
      }
      owner.declareBashGroup(groupSize);
      const members = Array.from({ length: groupSize }, (_, index) => {
        const member = owner.row('bash', { command: `printf sample-${index}`, timeout: 30 }, screen);
        member.setExpanded(true); member.setArgsComplete();
        if (index < groupSize - 1) member.updateResult(textResult('completed member\n'.repeat(1800)));
        screen.addChild(member);
        return member;
      });
      const row = members.at(-1);
      row.markExecutionStarted();
      let output = shape === 'short' ? 'short output\n'.repeat(1800).trimEnd() : 'x'.repeat(50 * 1024);
      row.updateResult(textResult(output), true);
      screen.renderNow();
      await feed(parsed, terminal.take());
      const events = {
        tick() { advance(1000); },
        append() { output += '\nnew tail'; row.updateResult(textResult(output), true); },
        'replace-tail'() { output = output.replace(/new tail$/u, 'changed tail'); row.updateResult(textResult(output), true); },
        'replace-prefix'() { output = output.replace(/^(?:short output|xxxxx)/u, 'replaced'); row.updateResult(textResult(output), true); },
        complete() { row.updateResult(textResult(output)); },
        resize() { terminal.columns = 80; parsed.resize(80, 40); },
        theme() { setTheme('light', false); for (const member of members) member.invalidate(); },
      };
      for (const [event, update] of Object.entries(events)) {
        const previous = screen.fullRedraws;
        update(); screen.renderNow();
        const data = terminal.take();
        const fullRedraws = screen.fullRedraws - previous;
        if (['tick', 'append', 'replace-tail'].includes(event)) {
          assert.equal(fullRedraws, 0, `${shape}/${history}/${event}`);
          assert.doesNotMatch(data, /offscreen-history-marker|\x1b\[(?:2J|3J)/u);
        }
        await feed(parsed, data);
        await compareWithFresh(members[0], parsed, terminal.columns, `${shape}/${history}/${groupSize}/${event}`);
        results.push({ shape, history, groupSize, event, bytes: Buffer.byteLength(data), fullRedraws });
      }
    } finally { owner.dispose(); screen.stop(); parsed.dispose(); }
  }
  setTheme('dark', false);
  return results;
}
