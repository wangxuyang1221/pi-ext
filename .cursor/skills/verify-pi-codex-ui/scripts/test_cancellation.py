import ast
import unittest
from pathlib import Path

path = Path(__file__).with_name('cli.py')
tree = ast.parse(path.read_text())
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'bash_output_started')
scope = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), scope)
started = scope['bash_output_started']


class CancellationReadiness(unittest.TestCase):
    def test_arguments_and_unrelated_updates_do_not_prove_output(self):
        events = [
            {'type': 'tool_execution_start', 'data': {'toolName': 'bash', 'args': {'command': 'printf BEGIN-CANCEL'}}},
            {'type': 'tool_execution_update', 'data': {'toolName': 'bash', 'args': {'command': 'printf BEGIN-CANCEL'}, 'partialResult': {'content': []}}},
            {'type': 'tool_execution_update', 'data': {'toolName': 'read', 'partialResult': {'content': [{'type': 'text', 'text': 'BEGIN-CANCEL'}]}}},
        ]
        self.assertFalse(started(events, 'BEGIN-CANCEL'))

    def test_public_bash_output_proves_execution(self):
        events = [{'type': 'tool_execution_update', 'data': {'toolName': 'bash', 'partialResult': {'content': [{'type': 'text', 'text': 'BEGIN-CANCEL'}]}}}]
        self.assertTrue(started(events, 'BEGIN-CANCEL'))


if __name__ == '__main__':
    unittest.main()
