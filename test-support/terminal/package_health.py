"""Check the pinned Pi host and the built package before a terminal journey."""
import argparse
import json
import subprocess
from pathlib import Path

import pyte


def inspect(repo, package):
    manifest = json.loads((package / 'package.json').read_text())
    resources = manifest['pi']
    theme = {'codex-ui': 'codex-pi', 'claude-code-ui': 'claude-code'}[package.name]
    expected = {'extensions': ['./dist/index.js'], 'themes': [f'./themes/{theme}.json']}
    for kind, entries in expected.items():
        if set(resources[kind]) != set(entries) or len(resources[kind]) != len(entries):
            raise ValueError(f'Unexpected {kind} in {package}: {resources[kind]}')
        for entry in entries:
            if not (package / entry).is_file():
                raise FileNotFoundError(package / entry)
    host = subprocess.run(
        ['node', '--input-type=module', '-e',
         'import {inspectPiHost} from "./scripts/pi-host.mjs"; console.log(JSON.stringify(inspectPiHost()))'],
        cwd=repo, capture_output=True, text=True, check=True, timeout=10,
    )
    return {'package': str(package), 'resources': resources, 'host': json.loads(host.stdout),
            'pyte': pyte.__file__}


def doctor(repo, package, evidence, label):
    name = f'doctor-{label}.json'
    (evidence / name).write_text(json.dumps(inspect(repo, package), indent=2))
    return name


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(Path.cwd(), args.package.resolve()), indent=2))
