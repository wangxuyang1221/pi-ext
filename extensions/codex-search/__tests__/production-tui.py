"""Drive production search tools through the real CLI against a loopback HTTP service."""

import codecs
import errno
import fcntl
import json
import os
import pty
import select
import signal
import shutil
import socket
import struct
import sys
import termios
import time
import threading
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import pyte

repo = Path(__file__).resolve().parents[3]
root = Path(sys.argv[1]).resolve()
evidence = Path(sys.argv[2]).resolve()
mode = sys.argv[3] if len(sys.argv) > 3 else "main"
assert mode in {"main", "fullscreen", "settings", "history"}
assert root.is_relative_to(repo / ".tmp") and evidence.is_relative_to(
    repo / ".tmp"
), "Use repository-local isolated directories"
assert (
    Path(os.environ["HOME"]).resolve() == root / "home"
), "Launch through verify.mjs isolation"
evidence.mkdir(parents=True, exist_ok=True)


def interrupted(signum, _frame):
    raise KeyboardInterrupt(f"Verification interrupted: {signum}")


for signum in (signal.SIGTERM, signal.SIGINT):
    signal.signal(signum, interrupted)
for name in ["workspace", "sessions"]:
    (root / name).mkdir(exist_ok=True)
requests = []
actions = []
checks = []
screens = {}
pids = []
transcripts = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        requests.append({"path": self.path, "method": "GET"})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {
                    "models": [
                        {
                            "slug": "audit-model",
                            "display_name": "Audit model",
                            "is_default": True,
                        }
                    ]
                }
            ).encode()
        )

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        entry = {
            "path": self.path,
            "body": body,
            "threadId": self.headers.get("thread-id"),
            "at": time.monotonic(),
        }
        requests.append(entry)
        text = body.get("input", [{}])[0].get("content", [{}])[0].get("text", "")
        if text == "error-query":
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"Audit service unavailable")
            return
        self.send_response(200)
        self.send_header(
            "Content-Type",
            (
                "text/event-stream"
                if self.path.endswith("/responses")
                else "application/json"
            ),
        )
        self.end_headers()
        if text == "cancel-query":
            self.wfile.flush()
            self.connection.settimeout(10)
            try:
                entry["clientClosed"] = self.connection.recv(1) == b""
            except Exception as error:
                entry["closeError"] = str(error)
            return
        if self.path.endswith("/responses"):
            if text == "slow-query":
                time.sleep(0.8)
            if text == "timeout-query":
                payload = (
                    "event: response.failed\ndata: "
                    + json.dumps({"error": {"message": "Request timed out"}})
                    + "\n\n"
                )
            else:
                data = {
                    "item": {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "Audit answer " + text,
                                "annotations": [
                                    {
                                        "type": "url_citation",
                                        "title": "Audit source",
                                        "url": "https://example.test/" + text,
                                    }
                                ],
                            }
                        ],
                    }
                }
                payload = (
                    "event: response.output_item.done\ndata: "
                    + json.dumps(data)
                    + '\n\nevent: response.completed\ndata: {"response":{"usage":{"total_tokens":1}}}\n\n'
                )
            self.wfile.write(payload.encode())
        else:
            ref = (
                "turn0view0"
                if len(
                    [
                        r
                        for r in requests
                        if "open" in r.get("body", {}).get("commands", {})
                    ]
                )
                == 1
                else "turn1view0"
            )
            self.wfile.write(
                json.dumps(
                    {
                        "output": "Audit page "
                        + ref
                        + " [Audit source](https://example.test/docs)",
                        "results": [
                            {
                                "ref_id": ref,
                                "url": "https://example.test/docs",
                                "title": "Audit page",
                            }
                        ],
                    }
                ).encode()
            )


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
port = server.server_port
origin = f"http://127.0.0.1:{port}"
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
(root / "agent/settings.json").write_text(
    json.dumps(
        {
            "quietStartup": True,
            "defaultProjectTrust": "never",
            "compaction": {"enabled": False},
            "retry": {"enabled": False},
            "cacheWarming": "off",
            "tuiMode": "fullscreen" if mode in {"fullscreen", "history"} else "regular",
        }
    )
)
config = root / "home/.pi/pi-codex-search.json"
config.parent.mkdir(exist_ok=True)
config.write_text(
    json.dumps({"baseUrl": origin, "model": "audit-model", "standaloneEnabled": True})
)


class Cli:
    def __init__(self, extra=None, overrides=None):
        extra = extra or []
        overrides = overrides or {}
        self.raw = bytearray()
        self.status = None
        self.screen = pyte.Screen(150, 65)
        self.stream = pyte.Stream(self.screen)
        self.decoder = codecs.getincrementaldecoder("utf8")("replace")
        env = dict(
            os.environ,
            PI_VERIFY_ROOT=str(root),
            AUDIT_ORIGIN=origin,
            TERM="xterm-256color",
            COLORTERM="truecolor",
        )
        env.update(overrides)
        args = [
            "node",
            str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
            "--offline",
            "--no-extensions",
            "--no-context-files",
            "--no-skills",
            "--no-prompt-templates",
            "--no-approve",
            "--session-dir",
            str(root / "sessions"),
            "--provider",
            "faux",
            "--model",
            "faux-1",
            "-e",
            str(repo / "extensions/codex-search/src/index.ts"),
            "-e",
            str(
                repo
                / "extensions/codex-search/__tests__/fixtures/production-search/provider.ts"
            ),
            "--theme",
            str(repo / "themes/codex-pi.json"),
            "--use-theme",
            "codex-pi",
            *extra,
        ]
        if "--approve" in extra:
            args.remove("--no-approve")
        actions.append(
            {"launch": args, "envOverrides": {"origin": origin, **overrides}}
        )
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(root / "workspace")
            os.execvpe(args[0], args, env)
        pids.append(self.pid)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 65, 150, 0, 0))

    def view(self):
        return "\n".join(x.rstrip() for x in self.screen.display)

    def pump(self):
        if select.select([self.fd], [], [], 0.04)[0]:
            try:
                data = os.read(self.fd, 65536)
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
                data = b""
            self.raw.extend(data)
            self.stream.feed(self.decoder.decode(data))
            if b"\x1b[6n" in data:
                os.write(self.fd, b"\x1b[1;1R")
        if self.status is None:
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.status = status

    def wait(self, predicate, label, seconds=25):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                screens[label] = self.view()
                return
            if self.status is not None:
                break
        raise AssertionError(label + "\n" + self.view())

    def settle(self):
        limit = time.monotonic() + 5
        quiet_until = time.monotonic() + 0.35
        while time.monotonic() < min(limit, quiet_until):
            before = len(self.raw)
            self.pump()
            if len(self.raw) != before:
                quiet_until = time.monotonic() + 0.35

    def keys(self, data, label):
        actions.append({"keys": label, "hex": data.hex()})
        os.write(self.fd, data)

    def command(self, text):
        self.keys(text.encode() + b"\r", text)

    def close(self):
        if self.status is None:
            self.command("/quit")
            try:
                self.wait(lambda: self.status is not None, "exit-" + str(self.pid), 5)
            except AssertionError:
                os.killpg(self.pid, signal.SIGTERM)
                try:
                    self.wait(
                        lambda: self.status is not None, "term-" + str(self.pid), 5
                    )
                except AssertionError:
                    os.killpg(self.pid, signal.SIGKILL)
                    _, self.status = os.waitpid(self.pid, 0)
        os.close(self.fd)
        transcripts.append(bytes(self.raw))
        try:
            os.kill(self.pid, 0)
            raise AssertionError("Owned CLI still alive")
        except ProcessLookupError:
            pass


def records(kind=None):
    path = root / "events.jsonl"
    items = (
        [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    )
    return [x for x in items if kind is None or x["type"] == kind]


def check(value, label):
    checks.append({"label": label, "passed": bool(value)})
    assert value, label


cli = None
passed = False
try:
    if mode == "settings":
        project = root / "workspace/.pi/pi-codex-search.json"
        project.parent.mkdir(exist_ok=True)
        project.write_text(json.dumps({"freshness": "cached", "batchSize": 9}))
        cli = Cli()
        cli.wait(lambda: records("ready"), "ready-untrusted")
        cli.settle()

        def status(label):
            cli.command("/codex-search-settings status")
            cli.wait(lambda: "(~/.pi/pi-codex-search.json)" in cli.view(), label)
            cli.settle()

        def menu():
            cli.command("/codex-search-settings")
            cli.wait(lambda: "Config scope" in cli.view(), "menu-" + str(len(actions)))
            cli.settle()

        def choose_setting(label):
            cli.keys(label.encode() + b"\r", "Filter " + label + " and change")
            cli.settle()

        def done():
            cli.keys(b"\x1b", "Close settings")
            cli.wait(
                lambda: "Reloaded" in cli.view(),
                "settings-reloaded-" + str(len(actions)),
            )
            cli.settle()

        def active():
            n = len(records("active"))
            cli.command("/audit-active")
            cli.wait(lambda: len(records("active")) > n, "active-" + str(n))
            cli.settle()
            return records("active")[-1]["data"]["tools"]

        status("untrusted-status")
        check(
            "project = (none)" in cli.view()
            and "maxBatchSize        = 5" in cli.view(),
            "Untrusted project fields ignored",
        )
        menu()
        check(
            "Project config disabled until" in cli.view(),
            "Untrusted menu limits scope to home",
        )
        choose_setting("Freshness")
        done()
        check(
            json.loads(config.read_text())["freshness"] == "cached",
            "Menu writes home freshness",
        )
        menu()
        choose_setting("Standalone")
        done()
        check(
            json.loads(config.read_text())["standaloneEnabled"] is False,
            "Disable standalone persisted",
        )
        check(
            "codex_search" in active() and "codex_standalone_web" not in active(),
            "Disabled standalone absent but responses stays active",
        )
        menu()
        choose_setting("Search context")
        done()
        check(
            json.loads(config.read_text())["searchContextSize"] == "low",
            "Responses low configured",
        )
        menu()
        choose_setting("Standalone")
        cli.keys(b"\r", "Cycle standalone to true")
        cli.settle()
        done()
        check(
            json.loads(config.read_text()).get("searchContextSize", "medium")
            == "medium",
            "Enabling standalone normalizes prior low context",
        )
        check(
            "codex_standalone_web" in active(),
            "Enabled standalone registered after reload",
        )
        menu()
        choose_setting("Enabled")
        done()
        check(
            "codex_search" not in active() and "codex_standalone_web" not in active(),
            "Disable all search tools",
        )
        menu()
        choose_setting("Enabled")
        done()
        check("codex_search" in active(), "Re-enable responses")
        home_bytes = config.read_bytes()
        (evidence / "home-before-reset.json").write_bytes(home_bytes)
        cli.command("/codex-search-settings reset")
        cli.wait(lambda: "Reset configuration" in cli.view(), "home-reset")
        cli.keys(b"\r", "Choose home deletion")
        cli.wait(lambda: "Delete config" in cli.view(), "home-confirm")
        cli.keys(b"\x1b", "Cancel home deletion")
        cli.wait(lambda: "Reset configuration" in cli.view(), "home-cancelled")
        check(config.read_bytes() == home_bytes, "Cancel preserves home config bytes")
        cli.keys(b"\r", "Choose home deletion again")
        cli.wait(lambda: "Delete config" in cli.view(), "home-confirm-again")
        cli.keys(b"\r", "Confirm home deletion")
        cli.wait(lambda: not config.exists(), "home-deleted")
        cli.keys(b"\x1b", "Exit home reset")
        cli.settle()
        # Restore only the loopback connection seed for the next trust scope.
        config.write_bytes(home_bytes)
        cli.close()
        cli = None
        before = len(records("ready"))
        cli = Cli(["--approve"], {"PI_CODEX_WEB_SEARCH_FRESHNESS": "indexed"})
        cli.wait(lambda: len(records("ready")) > before, "trusted-env-ready")
        cli.settle()
        status("trusted-env-status")
        check(
            "freshness           = indexed" in cli.view(),
            "Environment overrides both config files",
        )
        check(
            "env     = freshness" in cli.view()
            and "project = batchSize, freshness" in cli.view(),
            "Status reports env and project sources",
        )
        check(
            "maxBatchSize        = 9" in cli.view(), "Trusted project batch size active"
        )
        menu()
        check(
            "Config scope" in cli.view() and "project" in cli.view(),
            "Trusted menu defaults to project",
        )
        choose_setting("Freshness")
        cli.keys(b"\r", "Cycle freshness to default")
        cli.settle()
        done()
        check(
            "freshness" not in json.loads(project.read_text()),
            "Default selection clears explicit project field",
        )
        original = project.read_bytes()
        home_bytes = config.read_bytes()
        (evidence / "project-before-reset.json").write_bytes(original)
        cli.command("/codex-search-settings reset")
        cli.wait(lambda: "Reset configuration" in cli.view(), "project-reset")
        cli.keys(b"\r", "Choose project deletion")
        cli.wait(lambda: "Delete config" in cli.view(), "project-confirm")
        cli.keys(b"\x1b", "Cancel project deletion")
        cli.wait(lambda: "Reset configuration" in cli.view(), "project-cancelled")
        check(
            project.read_bytes() == original and config.read_bytes() == home_bytes,
            "Cancel preserves both scoped files",
        )
        cli.keys(b"\r", "Choose project deletion again")
        cli.wait(lambda: "Delete config" in cli.view(), "project-confirm-again")
        cli.keys(b"\r", "Confirm project deletion")
        cli.wait(lambda: not project.exists(), "project-deleted")
        check(config.read_bytes() == home_bytes, "Project reset preserves home file")
        cli.keys(b"\x1b", "Exit reset")
        cli.settle()
        cli.command("/codex-search-settings invalid")
        cli.wait(lambda: "Unknown subcommand" in cli.view(), "invalid-subcommand")
    else:
        cli = Cli()
        cli.wait(lambda: records("ready"), "ready")
        cli.settle()
        check("Extension issues" not in cli.view(), "Production source extension loads")

        def tool(name, args, error=False):
            before = len(records("settled"))
            n = len(records("tool"))
            cli.command("AUDIT " + json.dumps({"name": name, "args": args}))
            if name == "codex_search" and args.get("queries") == [
                "fast-query",
                "slow-query",
            ]:
                cli.wait(
                    lambda: "1/2 queries completed" in cli.view(),
                    "production-progress-1-of-2",
                )
            cli.wait(lambda: len(records("settled")) > before, "settled-" + str(before))
            cli.settle()
            screens["settled-" + str(before)] = cli.view()
            events = records("tool")[n:]
            check(len(events) == 1, "One tool completion per requested action")
            data = events[0]["data"]
            check(
                bool(data.get("isError")) == error, "Tool error status matches contract"
            )
            return data

        cli.command("/codex-search-settings status")
        cli.wait(lambda: "(~/.pi/pi-codex-search.json)" in cli.view(), "status-home")
        check(
            "baseUrl, model, standaloneEnabled" in cli.view(),
            "Status names home source fields",
        )
        cli.command("/codex-search-settings")
        cli.wait(lambda: "Config scope" in cli.view(), "settings-menu")
        cli.keys(b"Model\r", "Search Model and Enter")
        cli.wait(lambda: "audit-model" in cli.view(), "model-list")
        cli.keys(b"\x1b[A\r", "Choose automatic model")
        cli.settle()
        cli.keys(b"\x1b", "Save automatic model")
        cli.settle()
        check(
            "model" not in json.loads(config.read_text()),
            "Automatic model clears explicit model field",
        )
        cli.command("/codex-search-settings")
        cli.wait(lambda: "Config scope" in cli.view(), "settings-explicit-model")
        cli.keys(b"Model\r", "Open model chooser again")
        cli.settle()
        cli.keys(b"\x1b[B\r", "Choose fixture model")
        cli.settle()
        cli.keys(b"\x1b", "Save explicit model")
        cli.settle()
        check(
            json.loads(config.read_text())["model"] == "audit-model",
            "Model chooser persists selected model",
        )
        cli.command("/audit-active")
        cli.wait(lambda: records("active"), "active-initial")
        check(
            "codex_standalone_web" in records("active")[-1]["data"]["tools"],
            "Standalone enabled in host",
        )
        data = tool(
            "codex_search",
            {"queries": ["fast-query", "slow-query"], "freshness": "indexed"},
        )
        check(
            data["result"]["details"]["queryCount"] == 2,
            "Responses batch contains both queries",
        )
        posts = [r for r in requests if r["path"].endswith("/responses")]
        check(
            len(posts) == 2
            and all(
                r["body"]["tools"][0].get("indexed_web_access") is True for r in posts
            ),
            "Production responses posted both indexed queries",
        )
        check(
            "2 sources · 2 queries" in cli.view(),
            "Production TUI renders result summary",
        )
        cli.keys(b"\x0f", "Expand search")
        cli.wait(
            lambda: "https://example.test/slow-query" in cli.view(),
            "expanded-production",
        )
        cli.keys(b"\x0f", "Collapse search")
        cli.settle()
        url = "https://example.test/docs"
        tool("codex_standalone_web", {"urls": [url]})
        check(
            requests[-1]["body"]["commands"]["open"] == [{"ref_id": url}],
            "Open sends exact requested URL",
        )
        original_session = requests[-1]["body"]["id"]
        for action, params in [
            ("find", {"url": url, "pattern": "API"}),
            ("click", {"url": url, "id": 7}),
            ("screenshot", {"url": url, "pageno": 0}),
        ]:
            tool("codex_standalone_web", {action: [params]})
            expected = {key: value for key, value in params.items() if key != "url"}
            expected["ref_id"] = "turn0view0"
            check(
                requests[-1]["body"]["commands"][action] == [expected],
                action + " preserves action parameters and saved page ref",
            )
        for action, params in [
            ("finance", {"ticker": "AMD", "type": "equity", "market": "USA"}),
            ("weather", {"location": "Audit city"}),
            ("sports", {"fn": "standings", "league": "nba"}),
            ("time", {"utc_offset": "+08:00"}),
        ]:
            tool("codex_standalone_web", {action: [params]})
            check(
                requests[-1]["body"]["commands"][action] == [params],
                action + " request contract",
            )
        for args in [
            {"urls": [url], "find": [{"url": url, "pattern": "API"}]},
            {"urls": [url], "search_context_size": "low"},
        ]:
            n = len(requests)
            tool("codex_standalone_web", args, True)
            check(
                len(requests) == n, "Invalid standalone request makes no HTTP request"
            )
        tool("codex_search", {"queries": ["error-query"]}, True)
        check("HTTP 503" in cli.view(), "Production error diagnostic visible")
        tool("codex_search", {"queries": ["timeout-query"]}, True)
        check("timed out" in cli.view(), "Typed timeout visible")
        before = len(records("settled"))
        cli.command(
            "AUDIT "
            + json.dumps(
                {"name": "codex_search", "args": {"queries": ["cancel-query"]}}
            )
        )
        cli.wait(
            lambda: any(
                r.get("body", {})
                .get("input", [{}])[0]
                .get("content", [{}])[0]
                .get("text")
                == "cancel-query"
                for r in requests
            ),
            "cancel-request-arrived",
        )
        cli.keys(b"\x1b", "Escape cancels real request")
        cli.wait(lambda: len(records("settled")) > before, "cancel-settled")
        cli.wait(
            lambda: any(r.get("clientClosed") for r in requests),
            "HTTP client disconnected",
        )
        check(
            "interrupted" in cli.view() or "cancel" in cli.view().lower(),
            "Cancellation visible in TUI",
        )
        tool("codex_search", {"queries": ["recovery-query"]})
        check(
            "recovery-query" in cli.view(),
            "Successful search after errors and cancellation",
        )
        cli.command("/name Audit history A")
        cli.settle()
        session_files = list((root / "sessions").rglob("*.jsonl"))
        check(len(session_files) == 1, "One persisted session before new")
        target = str(session_files[0])
        cli.command("/new")
        cli.settle()
        active_before = len(records("active"))
        cli.command("/audit-active")
        cli.wait(lambda: len(records("active")) > active_before, "new-session-identity")
        check(
            records("active")[-1]["data"]["sessionId"] != original_session,
            "Native new creates a distinct session identity",
        )
        n = len(requests)
        tool("codex_standalone_web", {"find": [{"url": url, "pattern": "API"}]}, True)
        check(len(requests) == n, "New session rejects foreign URL without HTTP")
        cli.command("/resume")
        cli.wait(lambda: "Audit history A" in cli.view(), "native-resume-selector")
        cli.keys(b"Audit history A", "Filter session by name")
        cli.settle()
        cli.keys(b"\r", "Select history A")
        cli.settle()
        tool("codex_standalone_web", {"find": [{"url": url, "pattern": "API"}]})
        check(
            requests[-1]["body"]["commands"]["find"][0]["ref_id"] == "turn0view0",
            "Native resume restores original reference",
        )
        check(
            requests[-1]["body"]["id"] == original_session,
            "Native resume restores original request session identity",
        )
        before_reload_posts = sum("body" in request for request in requests)
        cli.command("/reload")
        cli.wait(lambda: "Reloaded" in cli.view(), "reload-with-history")
        check(
            sum("body" in request for request in requests) == before_reload_posts,
            "Reload does not replay historical search requests",
        )
        check(
            "Web search timed out" in cli.view()
            and "Web search interrupted" in cli.view(),
            "Reload preserves timeout and interruption cards",
        )
        tool(
            "codex_standalone_web", {"find": [{"url": url, "pattern": "after reload"}]}
        )
        check(
            requests[-1]["body"]["id"] == original_session,
            "Reload permits successful follow-up in original session",
        )
        cli.close()
        cli = None
        n = len(records("ready"))
        cli = Cli(["--session", target])
        cli.wait(lambda: len(records("ready")) > n, "cold-ready")
        cli.settle()
        screens["cold-history"] = cli.view()
        check(
            "Searched web" in cli.view() or "Web search" in cli.view(),
            "Cold process shows search history",
        )
        tool("codex_standalone_web", {"click": [{"url": url, "id": 8}]})
        check(
            requests[-1]["body"]["commands"]["click"][0]["ref_id"] == "turn0view0",
            "Cold process follow-up reuses original ref",
        )
        check(
            requests[-1]["body"]["id"] == original_session,
            "Cold process preserves original request session identity",
        )
        if mode == "history":

            def verify_history_cards(label):
                expected = {
                    "Web search failed", "Web search timed out", "Web search interrupted",
                    "Searched web", "Codex Standalone Web",
                }
                seen = set()
                pages = 0
                cli.wait(lambda: any(text in cli.view() for text in expected), label + " history ready")
                cli.settle()
                for index in range(12):
                    screens[f"{label}-page-{index}"] = cli.view()
                    seen.update(text for text in expected if text in cli.view())
                    if seen == expected:
                        break
                    previous = cli.view()
                    cli.keys(b"\x1b[5~", "PageUp searches historical diagnostic cards")
                    cli.wait(lambda: cli.view() != previous, label + " scroll changed")
                    cli.settle()
                    pages += 1
                for _ in range(pages):
                    cli.keys(b"\x1b[6~", "PageDown returns to latest messages")
                    cli.settle()
                check(
                    seen == expected,
                    label + " preserves success, failure, timeout, interruption and standalone cards",
                )

            cli.command("/settings")
            cli.wait(lambda: "Type to search" in cli.view(), "native-settings-theme")
            cli.keys(b"Theme\r", "Filter Theme and open chooser")
            cli.settle()
            cli.wait(lambda: "Select a theme" in cli.view(), "theme-chooser")
            for index in range(12):
                if any(
                    line.strip().startswith("→") and line.strip().endswith("light")
                    for line in cli.view().splitlines()
                ):
                    break
                cli.keys(b"\x1b[B", "Move theme selection down")
                cli.settle()
            else:
                raise AssertionError("Light theme option not selected")
            screens["selected-light-theme"] = cli.view()
            cli.keys(b"\r", "Choose light theme")
            cli.settle()
            cli.keys(b"\x1b", "Exit native settings")
            cli.settle()
            screens["light-history"] = cli.view()
            check(
                json.loads((root / "agent/settings.json").read_text())["theme"]
                == "light",
                "Native settings saved light theme",
            )
            (evidence / "settings-light.json").write_text(
                (root / "agent/settings.json").read_text()
            )
            verify_history_cards("Theme change")
            before_disable_posts = sum("body" in request for request in requests)
            cli.command("/codex-search-settings")
            cli.wait(lambda: "Config scope" in cli.view(), "disable-menu")
            cli.keys(b"Enabled\r", "Disable new search requests")
            cli.settle()
            cli.keys(b"\x1b", "Save and reload")
            cli.wait(lambda: "Reloaded" in cli.view(), "disabled-reload")
            cli.settle()
            check(
                json.loads(config.read_text())["enabled"] is False,
                "Disabled flag saved",
            )
            before = len(records("active"))
            cli.command("/audit-active")
            cli.wait(lambda: len(records("active")) > before, "disabled-tools")
            cli.settle()
            check(
                not {"codex_search", "codex_standalone_web"}.intersection(
                    records("active")[-1]["data"]["tools"]
                ),
                "Disabled tools excluded from active list",
            )
            verify_history_cards("Disabled history")
            screens["disabled-history"] = cli.view()
            cli.close()
            cli = None
            before = len(records("ready"))
            cli = Cli(["--session", target])
            cli.wait(lambda: len(records("ready")) > before, "disabled-cold-ready")
            cli.settle()
            verify_history_cards("Disabled cold resume")
            check(
                sum("body" in request for request in requests) == before_disable_posts,
                "Disabling and restoring history does not execute historical requests",
            )
            screens["disabled-cold-history"] = cli.view()
    check(not records("blocked-network"), "No non-fixture network attempts")
    passed = True
finally:
    # Always preserve the result of CLI cleanup alongside the remaining evidence.
    cleanup_errors = []
    if cli:
        try:
            cli.close()
        except Exception as error:
            cleanup_errors.append(str(error))
    server.shutdown()
    server.server_close()
    thread.join(2)
    probe = socket.socket()
    probe.settimeout(1)
    port_closed = probe.connect_ex(("127.0.0.1", port)) != 0
    probe.close()
    process_stopped = True
    for pid in pids:
        try:
            os.kill(pid, 0)
            process_stopped = False
        except ProcessLookupError:
            pass
    for name in ["home", "agent", "sessions", "workspace"]:
        try:
            shutil.copytree(root / name, evidence / name, dirs_exist_ok=True)
        except Exception as error:
            cleanup_errors.append(f"Archive {name}: {error}")
    (evidence / "events.jsonl").write_text(
        (root / "events.jsonl").read_text() if (root / "events.jsonl").exists() else ""
    )
    for i, data in enumerate(transcripts):
        (evidence / f"terminal-{i}.ansi").write_bytes(data)
    checks.append({"label": "Owned HTTP listener closed", "passed": port_closed})
    checks.append({"label": "Owned CLI processes stopped", "passed": process_stopped})
    (evidence / "requests.json").write_text(
        json.dumps(requests, ensure_ascii=False, indent=2)
    )
    (evidence / "driver-cleanup.json").write_text(
        json.dumps(
            {
                "pids": pids,
                "processStopped": process_stopped,
                "port": port,
                "portClosed": port_closed,
                "errors": cleanup_errors,
            },
            indent=2,
        )
    )
    (evidence / "journey.json").write_text(
        json.dumps(
            {
                "fixture": "production-search",
                "mode": mode,
                "passed": passed
                and port_closed
                and process_stopped
                and not cleanup_errors,
                "processStopped": process_stopped,
                "pids": pids,
                "port": port,
                "portClosed": port_closed,
                "actions": actions,
                "checks": checks,
                "screens": screens,
                "requests": requests,
                "cleanupErrors": cleanup_errors,
                "privateSocket": None,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    assert (
        port_closed and process_stopped and not cleanup_errors
    ), "Owned resource cleanup failed"
print("Production search CLI journey passed: " + mode)
