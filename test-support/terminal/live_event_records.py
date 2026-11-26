import json


def read_records(path, *, final=False):
    """Read complete LF-delimited events; reject a trailing row once the writer stops."""
    try:
        source = path.open("rb")
    except FileNotFoundError:
        return []
    records = []
    with source:
        for row in source:
            if not row.endswith(b"\n"):
                if final:
                    raise ValueError("Unterminated event record after the writer stopped")
                break
            records.append(json.loads(row.decode("utf-8")))
    return records
