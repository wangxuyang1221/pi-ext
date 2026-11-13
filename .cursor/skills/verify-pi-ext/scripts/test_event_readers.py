import ast
import json
from pathlib import Path
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[4]
READERS = [
    ("extensions/skill-mentions/__tests__/resume-summary-driver.py", "events"),
    ("extensions/codex-search/__tests__/production-tui.py", "records"),
    (".cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py", "events"),
]


class EventReaders(unittest.TestCase):
    def reader(self, relative, name, root):
        path = REPO / relative
        tree = ast.parse(path.read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
        scope = {"root": root, "json": json}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), scope)
        return scope[name]

    def test_appended_event_is_visible_only_after_its_newline(self):
        for relative, name in READERS:
            with self.subTest(reader=relative), tempfile.TemporaryDirectory(dir=REPO / ".tmp") as directory:
                root = Path(directory)
                read = self.reader(relative, name, root)
                self.assertEqual(read("settled"), [])
                first = {"type": "settled", "data": "first"}
                second = {"type": "settled", "data": "中文"}
                path = root / "events.jsonl"
                path.write_bytes(json.dumps(first).encode() + b"\n")
                expected = [first["data"]] if relative.startswith("extensions/skill-mentions/") else [first]
                encoded = json.dumps(second, ensure_ascii=False).encode() + b"\n"
                for byte in encoded[:-1]:
                    with path.open("ab") as output:
                        output.write(bytes([byte]))
                    self.assertEqual(read("settled"), expected)
                with path.open("ab") as output:
                    output.write(b"\n")
                expected.append(second["data"] if relative.startswith("extensions/skill-mentions/") else second)
                self.assertEqual(read("settled"), expected)
                self.assertEqual(read("other"), [])

    def test_malformed_completed_event_still_fails(self):
        for relative, name in READERS:
            with self.subTest(reader=relative), tempfile.TemporaryDirectory(dir=REPO / ".tmp") as directory:
                root = Path(directory)
                (root / "events.jsonl").write_bytes(b'{"type":\n')
                with self.assertRaises(json.JSONDecodeError):
                    self.reader(relative, name, root)("settled")

    def test_only_lf_delimits_records(self):
        for relative, name in READERS:
            with self.subTest(reader=relative), tempfile.TemporaryDirectory(dir=REPO / ".tmp") as directory:
                root = Path(directory)
                event = {"type": "settled", "data": "first\u0085middle\u2028last\u2029"}
                (root / "events.jsonl").write_bytes((json.dumps(event, ensure_ascii=False) + "\n").encode())
                expected = event["data"] if relative.startswith("extensions/skill-mentions/") else event
                self.assertEqual(self.reader(relative, name, root)("settled"), [expected])

    def test_completed_invalid_utf8_still_fails(self):
        for relative, name in READERS:
            with self.subTest(reader=relative), tempfile.TemporaryDirectory(dir=REPO / ".tmp") as directory:
                root = Path(directory)
                (root / "events.jsonl").write_bytes(b'{"type":"settled","data":"\xff"}\n')
                with self.assertRaises(UnicodeDecodeError):
                    self.reader(relative, name, root)("settled")


if __name__ == "__main__":
    unittest.main()
