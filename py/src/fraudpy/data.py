"""Shared data access for notebooks and scripts.

`get_con()` returns a DuckDB connection with slim, typed tables built once from the big CSVs and cached in
`data/work.duckdb` (git-ignored). Tables:

  tx    one row per transaction (only the columns the analysis needs)
  idn   identity records + a `dprof` device-profile key (DeviceInfo | OS | browser | screen, as in the README)
  cc    closed cases            pack   the 20 exam cases
  lab   one row per transaction that belongs to a closed case (tid, case_id, outcome, pattern)

`export_slim()` writes the same slim schema as `dataset/test`, so the backend can run on the real data
without loading 393 columns (see backend README).
"""
from __future__ import annotations

import os
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "Dataset"))
DB_PATH = ROOT / "data" / "work.duckdb"


def _has(con: duckdb.DuckDBPyConnection, name: str) -> bool:
    return con.execute("select count(*) from information_schema.tables where table_name = ?", [name]).fetchone()[0] > 0


def build(con: duckdb.DuckDBPyConnection, data_dir: Path = DATA_DIR) -> None:
    d = data_dir.as_posix()
    con.execute(f"""
        create or replace table tx as
        select TransactionID, customer_id, ts::timestamp as ts, channel, risk_score,
               TransactionAmt as amt, ProductCD as prod, card4, card6, addr1, addr2, dist1,
               P_emaildomain, R_emaildomain
        from read_csv('{d}/transactions.csv', header = true, sample_size = 200000)
    """)
    con.execute(f"""
        create or replace table idn as
        select TransactionID, DeviceType, DeviceInfo, id_15, id_23, id_30, id_31, id_33,
               coalesce(DeviceInfo,'?') || ' | ' || coalesce(id_30,'?') || ' | ' ||
               coalesce(id_31,'?') || ' | ' || coalesce(id_33,'?') as dprof
        from read_csv('{d}/identity.csv', header = true, sample_size = 100000)
    """)
    con.execute(f"create or replace table cc as select * from read_csv('{d}/closed_cases_history.csv', header = true)")
    con.execute(f"create or replace table pack as select * from read_csv('{d}/case_pack.csv', header = true)")
    con.execute("""
        create or replace table lab as
        select unnest(string_split(txn_ids, '|'))::bigint as tid, case_id, outcome, pattern from cc
    """)


def get_con(rebuild: bool = False) -> duckdb.DuckDBPyConnection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH))
    if rebuild or not _has(con, "tx"):
        build(con)
    return con


def export_slim(out_dir: Path, con: duckdb.DuckDBPyConnection | None = None) -> dict:
    """Write transactions/identity/closed/pack CSVs in the same slim schema as dataset/test."""
    con = con or get_con()
    out_dir.mkdir(parents=True, exist_ok=True)
    o = out_dir.as_posix()
    con.execute(f"""
        copy (select TransactionID, customer_id, strftime(ts, '%Y-%m-%d %H:%M:%S') as ts, channel, risk_score,
                     amt as TransactionAmt, prod as ProductCD, card4, card6, addr1, addr2, P_emaildomain, R_emaildomain
              from tx order by ts, TransactionID) to '{o}/transactions.csv' (header, delimiter ',')
    """)
    con.execute(f"""
        copy (select TransactionID, DeviceType, DeviceInfo, id_15, id_23, id_30, id_31, id_33 from idn order by TransactionID)
        to '{o}/identity.csv' (header, delimiter ',')
    """)
    con.execute(f"copy cc to '{o}/closed_cases_history.csv' (header, delimiter ',')")
    con.execute(f"copy pack to '{o}/case_pack.csv' (header, delimiter ',')")
    return {
        "transactions": con.execute("select count(*) from tx").fetchone()[0],
        "identity": con.execute("select count(*) from idn").fetchone()[0],
        "closed_cases": con.execute("select count(*) from cc").fetchone()[0],
        "pack": con.execute("select count(*) from pack").fetchone()[0],
        "out_dir": str(out_dir),
    }
