"""Exercise actual extension loading and in-process session switching in the Pi CLI."""
import codecs
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import pyte

repo = Path(__file__).resolve().parents[3]
(repo / ".tmp").mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="search-resume-", dir=repo / ".tmp") as folder:
    root = Path(folder)
    for directory in ["home", "agent", "sessions", "workspace", "tmp"]:
        (root / directory).mkdir()
    env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL"] if key in os.environ}
    env.update(HOME=str(root / "home"), TMPDIR=str(root / "tmp"), TERM="xterm-256color", COLORTERM="truecolor",
               PI_CODING_AGENT_DIR=str(root / "agent"), PI_CODING_AGENT_SESSION_DIR=str(root / "sessions"),
               PI_OFFLINE="1", PI_SKIP_VERSION_CHECK="1", PI_TELEMETRY="0")
    if "--disabled" in sys.argv:
        env["PI_CODEX_WEB_SEARCH_ENABLED"] = "false"
    (root / "agent/settings.json").write_text(json.dumps({"quietStartup": True, "terminal": {"showImages": False}}))
    code = '''
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
const root = process.argv[1];
const initial = SessionManager.create(root + '/workspace', root + '/sessions');
initial.appendMessage({ role: 'user', content: 'Resume fixture landing', timestamp: Date.now() });
const target = SessionManager.create(root + '/workspace', root + '/sessions');
const args = { queries: ['fixture query'], freshness: 'live', search_context_size: 'low' };
target.appendMessage({ role: 'user', content: 'Historical search fixture', timestamp: Date.now() });
target.appendMessage(fauxAssistantMessage([{ type: 'toolCall', id: 'history-search', name: 'codex_search', arguments: args }], { stopReason: 'toolUse' }));
target.appendMessage({ role: 'toolResult', toolCallId: 'history-search', toolName: 'codex_search', isError: false,
  content: [{ type: 'text', text: 'Offline search body' }], timestamp: Date.now(),
  details: { model: 'fixture', api: 'responses', freshness: 'live', searchContextSize: 'low', queryCount: 1, failedQueryCount: 0,
    queries: args.queries, successes: [{ query: args.queries[0], text: 'Offline search body', citations: [{ url: 'https://example.com' }], searchCalls: [] }], failures: [], elapsedMs: 13000 } });
console.log(JSON.stringify({ initial: initial.getSessionFile(), target: target.getSessionFile() }));
'''
    paths = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", code, str(root)], cwd=repo, env=env, text=True))
    fixture = root / "commands.ts"
    fixture.write_text('''export default function(pi) {
  pi.registerCommand('fixture-resume', { description: 'Switch to an isolated history fixture', handler: async (_args, ctx) => {
    await ctx.switchSession(TARGET);
  } });
  pi.registerCommand('fixture-active', { description: 'Report search exposure', handler: async (_args, ctx) => {
    ctx.ui.notify('Search callable: ' + pi.getActiveTools().includes('codex_search') + '; standalone callable: ' + pi.getActiveTools().includes('codex_standalone_web'), 'info');
  } });
  pi.registerCommand('fixture-theme', { description: 'Switch fixture theme', handler: async (name, ctx) => { ctx.ui.setTheme(name.trim()); } });
  pi.on('input', () => ({ action: 'handled' }));
}'''.replace("TARGET", json.dumps(paths["target"])))
    if "--global-host" in sys.argv:
        cli = [shutil.which("pi")]
    else:
        cli = ["node", str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js")]
    args = [*cli, "--offline", "--no-approve", "--no-extensions", "--no-context-files", "--no-skills", "--no-prompt-templates",
            "--extension", str(repo / "extensions/codex-search/src/index.ts"), "--extension", str(fixture),
            "--theme", str(repo / "themes/codex-pi.json"), "--use-theme", "codex-pi", "--session", paths["initial"]]
    if "--fullscreen" in sys.argv:
        # Both supported hosts read fullscreen mode from settings.
        settings = json.loads((root / "agent/settings.json").read_text())
        settings["tuiMode"] = "fullscreen"
        (root / "agent/settings.json").write_text(json.dumps(settings))
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(root / "workspace")
        os.execvpe(args[0], args, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 120, 0, 0))
    screen = pyte.Screen(120, 45)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    status = None

    def view():
        return "\n".join(screen.display)

    def pump():
        global status
        if select.select([fd], [], [], 0.05)[0]:
            try:
                stream.feed(decoder.decode(os.read(fd, 65536)))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        if status is None:
            done, value = os.waitpid(pid, os.WNOHANG)
            if done:
                status = value

    def wait(predicate, label):
        end = time.monotonic() + 40
        while time.monotonic() < end:
            pump()
            if predicate():
                return
            if status is not None:
                break
        raise AssertionError(f"{label}\n{view()}")

    def command(value):
        os.write(fd, value.encode() + b"\r")

    try:
        wait(lambda: "Resume fixture landing" in view(), "initial session")
        command("/fixture-resume")
        wait(lambda: "⌕ Searched web (fixture query)" in view(), "custom renderer on in-process resume")
        assert "1 source · 1 query · 13s" in view(), view()
        assert '"queries":' not in view(), view()
        command("/fixture-active")
        expected = "false" if "--disabled" in sys.argv else "true"
        wait(lambda: f"Search callable: {expected}; standalone callable: false" in view(), "execution exposure")
        os.write(fd, b"\x0f")
        wait(lambda: "responses · low · live" in view(), "expanded history")
        os.write(fd, b"\x0f")
        command("/fixture-theme light")
        end = time.monotonic() + 0.6
        while time.monotonic() < end:
            pump()
        assert "⌕ Searched web" in view(), view()
        command("/reload")
        wait(lambda: "Reloaded" in view(), "reload")
        assert "⌕ Searched web" in view(), view()
        command("/quit")
        wait(lambda: status is not None, "shutdown")
        assert os.waitstatus_to_exitcode(status) == 0
        print("PASS: actual search extension, in-process resume, expansion, theme, reload; " + " ".join(sys.argv[1:]))
    finally:
        if status is None:
            os.kill(pid, signal.SIGTERM)
            end = time.monotonic() + 5
            while status is None and time.monotonic() < end:
                pump()
            if status is None:
                os.killpg(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
        os.close(fd)
