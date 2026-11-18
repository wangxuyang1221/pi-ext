"""Test the real composer assertions without executing the CLI driver's top-level journey."""
import ast
import json
import unittest
from pathlib import Path
import pyte

path = Path.cwd() / '.cursor/skills/verify-pi-codex-ui/scripts/cli.py'
tree = ast.parse(path.read_text())
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('tone', 'composer')]
helpers = dict(json=json, REPO=Path.cwd())
exec(compile(ast.Module(body=functions[:1], type_ignores=[]), str(path), 'exec'), helpers)
BG, FG = helpers['tone']('selectedBg'), helpers['tone']('text')


class ComposerAssertions(unittest.TestCase):
    def drive(self, foreground=FG, background=BG, expected=BG, mixed=False):
        screen = pyte.Screen(40, 5)
        stream = pyte.Stream(screen)
        ansi = lambda value, slot: f'\x1b[{slot};2;' + ';'.join(str(int(value[i:i+2], 16)) for i in (0, 2, 4)) + 'm'
        for row in range(1, 4):
            stream.feed(f'\x1b[{row};1H' + ansi(background, 48) + ' ' * 40)
        stream.feed('\x1b[2;1H' + ('\x1b[39m' if foreground is None else ansi(foreground, 38)) + 'COMPOSER-INPUT')
        if mixed:
            stream.feed('\x1b[2;2H' + ansi('ffffff', 38) + 'O')
        def check(condition, label):
            self.assertTrue(condition, label)
        scope = dict(screen=screen, keys=lambda *args: None, settle=lambda: None, snap=lambda *args: None, check=check, CODEX_BG=BG, CODEX_FG=FG)
        exec(compile(ast.Module(body=functions[1:], type_ignores=[]), str(path), 'exec'), scope)
        scope['composer']('fixture', expected)

    def test_readable_codex_and_light(self):
        self.drive()
        self.drive('222222', 'eeeeee', None)

    def test_default_foreground_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'readable draft'):
            self.drive(None)

    def test_invisible_foreground_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'readable draft'):
            self.drive(BG)

    def test_mixed_foreground_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'readable draft'):
            self.drive(mixed=True)

    def test_wrong_codex_color_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'codex-pi text color'):
            self.drive('ffffff')


if __name__ == '__main__':
    unittest.main()
