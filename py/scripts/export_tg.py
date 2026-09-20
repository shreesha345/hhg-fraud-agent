"""Turn a slim dataset folder into TigerGraph loading files (one CSV per vertex type and edge type).

    uv run python scripts/export_tg.py --src ../Dataset/test --out ../data/tg-test
    uv run python scripts/export_tg.py --src ../data/slim   --out ../data/tg-real

The source has the slim schema (same as Dataset/test and the output of export_slim.py). Card resolution mirrors
backend/src/store/InMemoryStore.ts exactly: a card is customer|network|type, its `Cxxxxx-Kn` label is an alias learned from
closed cases and the case pack, and a card that no source names gets a heuristic label flagged `derived`.
All files are tab-separated, unquoted, with a header row (device profiles and card ids contain '|', so '|' cannot be the separator).
"""
import argparse
import calendar
from datetime import datetime
from pathlib import Path

import duckdb

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args()
src, out = Path(a.src).resolve(), Path(a.out).resolve()
out.mkdir(parents=True, exist_ok=True)
s, o = src.as_posix(), out.as_posix()

con = duckdb.connect()
con.execute(f"create table tx0 as select * from read_csv('{s}/transactions.csv', header=true, sample_size=200000)")
con.execute(f"create table id0 as select * from read_csv('{s}/identity.csv', header=true, sample_size=100000)")
con.execute(f"create table cc0 as select * from read_csv('{s}/closed_cases_history.csv', header=true)")
con.execute(f"create table pk0 as select * from read_csv('{s}/case_pack.csv', header=true)")

# ------------------------------------------------------------------ transactions with card key and epoch seconds (UTC)
con.execute("""
create table tx as
select cast(TransactionID as varchar) as id, customer_id as customer,
       customer_id || '|' || coalesce(card4,'~') || '|' || coalesce(card6,'~') as card,
       coalesce(card4,'~') as network, coalesce(card6,'~') as ctype,
       cast(epoch(cast(ts as timestamp)) as bigint) as ts, cast(TransactionAmt as double) as amt, ProductCD as prod, channel,
       cast(risk_score as double) as score, coalesce(cast(cast(addr1 as integer) as varchar), '') as region,
       coalesce(P_emaildomain, '') as email
from tx0""")

# device profile = DeviceInfo | id_30 | id_31 | id_33 (README definition), as in the store
con.execute("""
create table dev as
select cast(TransactionID as varchar) as txn,
       coalesce(DeviceInfo,'?') || ' | ' || coalesce(id_30,'?') || ' | ' || coalesce(id_31,'?') || ' | ' || coalesce(id_33,'?') as profile,
       split_part(coalesce(DeviceInfo,'?'), ' ', 1) as fam_raw,
       (id_15 = 'New') as is_new, coalesce(id_23, '') as proxy
from id0""")

# ------------------------------------------------------------------ card labels: alias from closed cases and case pack
con.execute("""
create table bind as
select label, card from (
  select label, card, row_number() over (partition by label order by opened) as rn from (
    select cc.card_id as label, t.card, cc.opened_at as opened from cc0 cc join tx t on cast(t.id as bigint) = cast(coalesce(nullif(split_part(cc.txn_ids,'|',1),''),'0') as bigint)
    union all
    select p.card_id, t.card, p.opened_at from pk0 p join tx t on t.id = cast(p.flagged_txn_id as varchar)
  )
) where rn = 1""")
con.execute("""
create table cards as
select c.card as id, c.customer, c.network, c.ctype,
       coalesce(b.label, c.customer || '-K' || cast(row_number() over (partition by c.customer order by c.ctype, c.network) as varchar)) as label,
       (b.label is null) as derived
from (select distinct card, customer, network, ctype from tx) c left join (select distinct on (card) card, label from bind) b on b.card = c.card""")

def dump(sql: str, name: str) -> None:
    con.execute(f"copy ({sql}) to '{o}/{name}.tsv' (header, delimiter '	', quote '')")

dump("select distinct customer as id from tx", "v_customer")
dump("select id, customer, network, ctype, label, derived as label_derived from cards", "v_card")
dump("select id, ts, amt, prod, channel, score, coalesce(try_cast(region as integer), -1) as region from tx order by ts", "v_transaction")
dump("select distinct profile as id, fam_raw as family from dev", "v_device")
dump("select distinct region as id from tx where region <> ''", "v_region")
dump("select distinct email as id from tx where email <> ''", "v_email")
dump("select distinct customer, card from tx", "e_owns")
dump("select card, id as txn, ts from tx", "e_made")
dump("select d.txn, d.profile, t.ts, d.is_new, d.proxy from dev d join tx t on t.id = d.txn", "e_from_device")
dump("select id as txn, region, ts from tx where region <> ''", "e_billed_in")
dump("select id as txn, email, ts from tx where email <> ''", "e_purchaser_email")
dump("select id as a, lead(id) over (partition by card order by ts, cast(id as bigint)) as b from tx qualify b is not null", "e_next")

# ------------------------------------------------------------------ closed cases (memory) and their links
con.execute("""
create table cc as
select case_id as id, customer_id as customer, card_id as card_label, outcome, pattern,
       cast(epoch(cast(opened_at as timestamp)) as bigint) as opened_ts, cast(epoch(cast(closed_at as timestamp)) as bigint) as closed_ts,
       coalesce(cast(exposure_usd as double), 0) as exposure,
       replace(replace(replace(replace(coalesce(analyst_notes,''), chr(9), ' '), chr(10), ' '), chr(13), ' '), '"', chr(39)) as notes,
       (lower(cast(report_filed as varchar)) in ('yes','true')) as report_filed, coalesce(actions_taken,'') as actions,
       coalesce(txn_ids,'') as txn_ids, coalesce(connected_card_ids,'') as connected
from cc0""")
dump("select id, customer, card_label, outcome, pattern, opened_ts, closed_ts, exposure, notes, report_filed, actions from cc", "v_closedcase")
dump("select distinct pattern as id from cc where pattern <> ''", "v_pattern")
dump("select id as caseid, unnest(string_split(txn_ids, '|')) as txn, generate_subscripts(string_split(txn_ids, '|'), 1) - 1 as seq from cc where txn_ids <> ''", "e_closed_involves")
dump("select c.id as caseid, b.card from cc c join (select distinct on (label) label, card from bind) b on b.label = c.card_label", "e_closed_on_card")
dump("""select c.id as caseid, b.card from (select id, unnest(string_split(connected, '|')) as lab from cc where connected <> '') c
        join (select distinct on (label) label, card from bind) b on b.label = c.lab""", "e_closed_connected")
dump("select id as caseid, pattern from cc where pattern <> ''", "e_closed_matches")

n = {t: con.execute(f"select count(*) from {t}").fetchone()[0] for t in ["tx", "dev", "cards", "cc"]}
print({"out": str(out), **n, "derived_cards": con.execute("select count(*) from cards where derived").fetchone()[0]})
