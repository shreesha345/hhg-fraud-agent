"""Export slim CSVs of the REAL data (same schema as dataset/test) for the backend's in-memory store.

Usage: uv run python scripts/export_slim.py            # writes data/slim/
Builds the DuckDB cache first if needed (takes a minute or two on the 708 MB file).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py" / "src"))
from fraudpy.data import export_slim  # noqa: E402

print(export_slim(ROOT / "data" / "slim"))
