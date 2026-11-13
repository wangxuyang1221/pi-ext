import ast
import json
from pathlib import Path
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[4]
READERS = [
    ("extensions/skill-mentions/__tests__/resume-summary-driver.py", "events"),
    ("extensions/codex-search/__tests__/production-tui.py", "records"),
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
                expected = [first["data"]] if name == "events" else [first]
                encoded = json.dumps(second, ensure_ascii=False).encode() + b"\n"
                for byte in encoded[:-1]:
                    with path.open("ab") as output:
                        output.write(bytes([byte]))
                    self.assertEqual(read("settled"), expected)
                with path.open("ab") as output:
                    output.write(b"\n")
                expected.append(second["data"] if name == "events" else second)
                self.assertEqual(read("settled"), expected)
                self.assertEqual(read("other"), [])

    def test_malformed_completed_event_still_fails(self):
        for relative, name in READERS:
            with self.subTest(reader=relative), tempfile.TemporaryDirectory(dir=REPO / ".tmp") as directory:
                root = Path(directory)
                (root / "events.jsonl").write_bytes(b'{"type":\n')
                with self.assertRaises(json.JSONDecodeError):
                    self.reader(relative, name, root)("settled")


if __name__ == "__main__":
    unittest.main()
