"""Read records emitted by the local MCP verification processes."""
import json
from pathlib import Path


def read_records(path: Path):
    if not path.exists():
        return []
    # Writers append JSON plus LF. A snapshot may stop anywhere in the next
    # record, even inside UTF-8. Decode only LF-terminated records; malformed
    # completed records must still fail rather than silently hiding evidence.
    return [json.loads(line.decode('utf-8')) for line in path.read_bytes().split(b'\n')[:-1]]
