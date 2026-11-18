import json


def read_records(path, *, final=False):
    """Read complete LF-delimited events; reject a trailing row once the writer stops."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return []
    *rows, trailing = data.split(b"\n")
    records = [json.loads(row.decode("utf-8")) for row in rows]
    if final and trailing:
        raise ValueError("Unterminated event record after the writer stopped")
    return records
