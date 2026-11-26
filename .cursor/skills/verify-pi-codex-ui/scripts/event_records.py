"""Keep the verification drivers' event-reader import available."""
from pathlib import Path
import sys

SHARED_TERMINAL = Path(__file__).resolve().parents[4] / "test-support/terminal"
sys.path.insert(0, str(SHARED_TERMINAL))
from live_event_records import read_records
