"""Regenerate dataset/test (synthetic, deterministic). Usage: python scripts/make_test_dataset.py [--seed 42]"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "py" / "src"))
from fraudpy.testdata import build  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--seed", type=int, default=42)
a = ap.parse_args()
print(build(ROOT / "dataset" / "test", a.seed))
