"""Builds (and optionally executes) the two explanatory notebooks.

    uv run python scripts/build_notebooks.py            # write .ipynb files only
    uv run python scripts/build_notebooks.py --execute  # also run them, saving outputs

Notebooks are generated from this file so the explanations stay reviewable as plain text.
"""
import argparse
import sys
from pathlib import Path

import nbformat as nbf
from nbclient import NotebookClient

HERE = Path(__file__).resolve().parent
NB_DIR = HERE.parent / "notebooks"


def md(text: str):
    return nbf.v4.new_markdown_cell(text.strip("\n"))


def code(text: str):
    return nbf.v4.new_code_cell(text.strip("\n"))


SETUP = '''
import sys
sys.path.insert(0, "../src")            # so `import fraudpy` works from the notebooks folder

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from fraudpy.data import get_con, DATA_DIR, ROOT

pd.set_option("display.width", 170)
pd.set_option("display.max_columns", 40)
pd.set_option("display.max_colwidth", 90)
plt.rcParams.update({"figure.figsize": (8, 3.6), "axes.spines.top": False, "axes.spines.right": False})

con = get_con()                          # slim DuckDB tables, built once and cached in data/work.duckdb
q = lambda sql, *p: con.execute(sql, list(p)).df()   # run SQL, get a DataFrame
print("data folder:", DATA_DIR)
'''

# --------------------------------------------------------------------------------------------------
# Notebook 1
# --------------------------------------------------------------------------------------------------
NB1 = [
md("""
# 01 · Understanding the dataset

**Purpose.** Before designing any agent we measured what the data actually says. Every design decision in
`CLAUDE.md` traces back to a number in this notebook.

**What you will see.** Each section states a question, runs the query that answers it, and then says what it means
for the agent. Nothing here is modelled or tuned; it is all direct measurement.

**How to run.** From `py/`: `uv sync`, then open this file in Jupyter or VS Code and *Run All*. The first run builds a
DuckDB cache from the 708 MB `transactions.csv` (about a minute); after that everything is fast.

**Hard rule.** Only the provided files are used. The original public IEEE-CIS files must never be used to recover outcomes.
"""),
md("""
## 1 · Setup

We use **DuckDB**: it reads CSV directly, is very fast for the window queries we need (bursts, recurring charges,
"what happened before this case opened"), and needs no server. `get_con()` keeps only the columns the analysis uses,
so the 393 anonymous Vesta columns do not slow every query.
"""),
code(SETUP),
md("""
## 2 · The files

Five files, one join key. `transactions.csv` joins `identity.csv` on `TransactionID`. Identity exists only for online
transactions.
"""),
code('''
files = ["transactions.csv", "identity.csv", "closed_cases_history.csv", "case_pack.csv"]
sizes = pd.DataFrame({
    "file": files,
    "MB": [round((DATA_DIR / f).stat().st_size / 1e6, 1) for f in files],
    "rows": [q("select count(*) n from tx").n[0], q("select count(*) n from idn").n[0],
             q("select count(*) n from cc").n[0], q("select count(*) n from pack").n[0]],
})
sizes
'''),
md("""
## 3 · Time and channel

`ts` is the real timestamp (use it, not `TransactionDT`). `channel` is `in_person` for product `W` (no identity record) and
`online` for products C/H/R/S.
"""),
code('''
display(q("select min(ts) first_ts, max(ts) last_ts, count(distinct customer_id) customers from tx"))
display(q("select channel, prod, count(*) n, round(avg(risk_score),3) mean_score, round(median(amt),1) median_amt from tx group by 1,2 order by 1,2"))
'''),
md("""
### The future is in the file

A case opens some hours *after* its flagged transaction, and the file keeps going to December 31. If the agent ever queried
without an upper time bound, it would see events that had not happened yet. **Every query in the agent takes `as_of = opened_at`.**
"""),
code('''
gap = q("""
    select p.case_id, p.trigger_type, t.ts as flagged_ts, p.opened_at,
           round(epoch(p.opened_at - t.ts) / 3600, 1) as hours_after_flagged_txn
    from pack p join tx t on t.TransactionID = p.flagged_txn_id order by 1
""")
print("hours between the flagged transaction and the case opening:")
print(gap.hours_after_flagged_txn.describe().round(1).to_string())
gap.head(5)
'''),
md("""
## 4 · The closed cases (the only place the truth is written down)

4,665 confirmed fraud, 900 cleared. Patterns are the five documented ones plus `undocumented`. Cleared cases have pattern `none`.
"""),
code('''
q("""
    select outcome, pattern, count(*) cases, round(avg(exposure_usd),0) avg_exposure, round(avg(n_txns),1) avg_txns,
           sum(case when report_filed in ('Yes','True','true') then 1 else 0 end) reports_filed
    from cc group by 1,2 order by 1,3 desc
""")
'''),
code('''
q("select actions_taken, outcome, count(*) n from cc group by 1,2 order by 3 desc")
'''),
md("""
**Note for the agent.** Closed cases are *templated*: analyst notes are nearly identical within a pattern. Text similarity alone
would therefore be weak memory. The useful memory is **structural**: closed cases point at real transactions, cards and devices.
"""),
md("""
## 5 · The risk score is close to a decoy

The README warns the score is "often wrong in both directions". Here is how wrong. We label every transaction that belongs to a
closed case (`lab`), and compare the bank score for confirmed fraud, cleared cases, and everything with no case.
"""),
code('''
grp = q("""
    select coalesce(l.outcome, 'no_case') as group_, count(*) n,
           round(avg(t.risk_score),3) mean_score, round(quantile_cont(t.risk_score,0.5),3) median_score,
           round(avg((t.risk_score >= 0.7)::int),3) share_ge_070, round(avg((t.risk_score < 0.3)::int),3) share_lt_030,
           round(min(t.risk_score),2) min_score
    from tx t left join lab l on l.tid = t.TransactionID group by 1
""")
grp
'''),
code('''
bins = q("""
    select floor(t.risk_score*10)/10 as bin, l.outcome, count(*) n
    from lab l join tx t on t.TransactionID = l.tid group by 1,2
""")
pv = bins.pivot(index="bin", columns="outcome", values="n").fillna(0)
ax = pv.plot(kind="bar", color={"confirmed_fraud": "#B45309", "cleared": "#0F766E"}, width=0.8)
ax.set_xlabel("bank risk score bin (start of range)"); ax.set_ylabel("transactions in closed cases")
ax.set_title("Cleared cases only exist at score 0.8 and above; fraud is spread across the whole range")
plt.xticks(rotation=0); plt.tight_layout(); plt.show()
'''),
md("""
**What it means.**
- All 900 cleared cases scored at least 0.81. A score of 0.9 is where *innocence* lives, not just guilt.
- Confirmed fraud averages 0.47 and roughly a third of it scores under 0.3.
- So the score cannot be a threshold. It is one evidence class whose effect is learned, and it must be possible to clear a 0.9 and convict a 0.05.
"""),
md("""
## 6 · Why alerts were cleared

The analyst notes for cleared cases state the reason. Counting them tells the agent which *innocent explanations* it needs
to be able to test for.
"""),
code('''
cleared = q("select case_id, analyst_notes from cc where outcome = 'cleared'")
def reason(n):
    n = n.lower()
    if "travel" in n: return "travel to the billing region"
    if "new phone" in n: return "purchase from a new phone"
    if "unusual" in n: return "unusual amount, confirmed by customer"
    return "other"
cleared["reason"] = cleared.analyst_notes.map(reason)
r = cleared.reason.value_counts().to_frame("cases"); r["share"] = (r.cases / r.cases.sum()).round(3); r
'''),
md("""
**What it means.** Three innocent explanations cover the history, and **every cleared case was triggered by the model score**. There is
no history of innocent *customer-report* cases, so policy rule R7 (a recurring charge the customer disputes) cannot be learned from memory.
It needs a rule-based test (recurring cadence with a coincidence check).
"""),
md("""
## 7 · Two undocumented patterns

The README says not every pattern is documented. Closed history contains nine cases marked `undocumented`. Reading them gives two patterns.
"""),
code('''
q("select case_id, n_txns, exposure_usd, analyst_notes from cc where pattern = 'undocumented' order by case_id")
'''),
md("""
### 7a · The device ring

The notes describe one device, behind an anonymous proxy, "never seen on this account", shared across cardholders. The device profile key
follows the README: `DeviceInfo | OS | browser | screen`. We find the fingerprint and look at how it behaves *over time* and *at what score*.
"""),
code('''
RING = "SM-G935F Build/NRD90M | Android 7.0 | chrome 62.0 for android | 1920x1080"
ring = q("""
    select t.TransactionID, t.customer_id, t.ts, t.amt, t.risk_score, d.id_15, d.id_23, l.case_id, l.pattern
    from idn d join tx t using (TransactionID) left join lab l on l.tid = t.TransactionID
    where d.dprof = ? and d.id_23 = 'IP_PROXY:ANONYMOUS'
""", RING)
print("fingerprint:", RING)
print("every row is New:", (ring.id_15 == "New").all(), "| transactions:", len(ring), "| customers:", ring.customer_id.nunique())
by_month = ring.assign(month=ring.ts.dt.to_period("M")).groupby("month").agg(
    txns=("TransactionID", "count"), customers=("customer_id", "nunique"), in_closed_cases=("case_id", "count"),
    min_score=("risk_score", "min"), max_score=("risk_score", "max"))
by_month
'''),
code('''
live = ring[ring.ts >= "2016-11-01"]
print(f"Nov-Dec: {len(live)} transactions across {live.customer_id.nunique()} customers, "
      f"scores {live.risk_score.min():.2f} to {live.risk_score.max():.2f}, in any closed case: {int(live.case_id.notna().sum())}")
fig, ax = plt.subplots()
ax.hist(live.risk_score, bins=np.arange(0, 1.05, 0.05), color="#B45309")
ax.set_xlim(0, 1); ax.set_xlabel("bank risk score"); ax.set_ylabel("ring transactions (Nov-Dec)")
ax.set_title("A live fraud ring the bank model never flagged"); plt.tight_layout(); plt.show()
'''),
md("""
**What it means.** These victims are invisible to a score-driven agent. The signal is the *fingerprint*: rare, always `New`, always behind an
anonymous proxy. Case **HHG-014** (an analyst request with score 0.05) belongs to this ring. The design needs a score-blind sweep that starts
from confirmed-fraud entities and weights devices by rarity, because generic devices (thousands of customers) are noise.

Check the rarity idea directly: how many customers share each device profile?
"""),
code('''
rarity = q("""
    select d.dprof, count(distinct t.customer_id) customers, count(*) txns
    from idn d join tx t using (TransactionID) group by 1
""")
print("device profiles:", len(rarity))
print(rarity.customers.describe(percentiles=[.5, .9, .99]).round(1).to_string())
print("ring fingerprint is shared by", int(rarity.loc[rarity.dprof == RING, "customers"].iloc[0]), "customers")
rarity.sort_values("customers", ascending=False).head(5)
'''),
md("""
### 7c · How specific must a "ring" rule be?

A rule that calls a device profile a ring must not fire on ordinary devices. We test candidate rules against **every** device profile (not against any exam case). Per profile:
number of customers, share of uses marked `New`, and share behind an anonymous proxy.
""" ),
code('''
prof = q("""
    select d.dprof, count(distinct t.customer_id) users, count(*) txns,
           avg((d.id_15 = 'New')::int) new_share, avg((d.id_23 = 'IP_PROXY:ANONYMOUS')::int) anon_share
    from idn d join tx t using (TransactionID) group by 1""")
rules = {
    "loose: 4+ users, New >= 0.7, and (proxy >= 0.5 or 8+ users)": (prof.users >= 4) & (prof.new_share >= 0.7) & ((prof.anon_share >= 0.5) | (prof.users >= 8)),
    "with proxy: 4+ users, New >= 0.7, proxy >= 0.5":               (prof.users >= 4) & (prof.new_share >= 0.7) & (prof.anon_share >= 0.5),
    "chosen: 5-200 users, New >= 0.9, proxy >= 0.8":                (prof.users >= 5) & (prof.users <= 200) & (prof.new_share >= 0.9) & (prof.anon_share >= 0.8),
}
print(f"{len(prof):,} device profiles in total; one documented ring\\n")
print(pd.Series({k: int(m.sum()) for k, m in rules.items()}, name="profiles flagged").to_string())
print("\\nwhat the chosen rule flags:")
prof[rules["chosen: 5-200 users, New >= 0.9, proxy >= 0.8"]].sort_values("txns", ascending=False)
'''),
md("""
**What it means.** The loose rule flags over two hundred profiles, mostly generic iPhone profiles shared by hundreds of customers, which is background noise, not a ring. Requiring an anonymous proxy and an
almost-always-`New` pattern (what the closed ring cases actually describe) leaves the documented ring and a very small number of others. The backend uses the chosen rule
(`sharedRareFingerprint` in `backend/src/engines/signatures/index.ts`) and has tests for each of its conditions.
"""),
md("""
### 7b · Threshold structuring

The other notes: "four online purchases within forty minutes, each just under $500". We test that as a *window query*: three or more online
transactions between $400 and $500 on one customer inside an hour.
"""),
code('''
struct = q("""
    with s as (
      select t.*, count(*) over (partition by customer_id order by epoch(ts) range between 3600 preceding and current row) as w
      from tx t where channel = 'online' and amt between 400 and 499.99)
    select s.customer_id, min(s.ts) first_ts, count(*) txns, round(sum(amt),2) total, round(avg(risk_score),2) mean_score,
           any_value(l.case_id) closed_case, any_value(l.pattern) pattern
    from s left join lab l on l.tid = s.TransactionID where w >= 3 group by 1 order by first_ts
""")
struct["month"] = struct.first_ts.dt.to_period("M")
print(struct.groupby("month").agg(customers=("customer_id", "count"), in_closed_cases=("closed_case", "count")).to_string())
struct[struct.pattern == "undocumented"]
'''),
md("""
**What it means.** The closed structuring cases score low (0.04 to 0.38) and cluster in September; the exam period contains more customers with the same
shape (for example **HHG-006**). The agent needs a `threshold hugging` signature, and a generic novelty detector for the ones nobody has named.
Some heavy natural users also trip this query, which is why the signature is judged against the card's own baseline, not in isolation.
"""),
md("""
## 8 · A "customer" is not a person

`customer_id` is derived from the issuer field. Some customers have thousands of transactions, which no single person makes.
"""),
code('''
size = q("select customer_id, count(*) n from tx group by 1")
size["bucket"] = pd.cut(size.n, [0, 200, 1000, 3000, 10**9], labels=["<=200", "201-1000", "1001-3000", ">3000"])
s = size.groupby("bucket", observed=True).agg(customers=("customer_id", "count"), txns=("n", "sum"))
s["share_of_all_txns"] = (s.txns / s.txns.sum()).round(3); s
'''),
md("""
**What it means.** About a hundred "customers" hold nearly half of all rows. Baselines like "this customer's usual amount" are meaningless for them.
The agent computes baselines **per card and per region**, and flags aggregate customers so their anomalies are down-weighted.
"""),
md("""
## 9 · Cards: the ID in the cases is not in the transactions

Cases refer to cards like `C01234-K2`, but `transactions.csv` has no card ID. We can resolve a card as
*(customer, network `card4`, type `card6`)*. Can we also reproduce the `K1`/`K2` numbering from card fields?
"""),
code('''
per_cust = q("""
    select n_cards, count(*) customers from (
      select customer_id, count(distinct coalesce(card4,'~') || '|' || coalesce(card6,'~')) n_cards from tx group by 1)
    group by 1 order by 1""")
display(per_cust)

con.execute("""create or replace temp table truth as
    select distinct cc.card_id, t.customer_id, coalesce(t.card4,'~') c4, coalesce(t.card6,'~') c6
    from lab l join cc using (case_id) join tx t on t.TransactionID = l.tid""")
con.execute("""create or replace temp table cand as
    with g as (select customer_id, coalesce(card4,'~') c4, coalesce(card6,'~') c6, count(*) n, min(ts) first_ts from tx group by 1,2,3)
    select *, row_number() over (partition by customer_id order by c6, c4) k_alpha,
              row_number() over (partition by customer_id order by n desc) k_volume,
              row_number() over (partition by customer_id order by first_ts) k_first from g""")
rules = {}
for k in ["k_alpha", "k_volume", "k_first"]:
    rules[k] = q(f"""select avg((t.card_id = c.customer_id || '-K' || c.{k})::int) match_rate, count(*) cards_tested
                    from truth t join cand c on c.customer_id = t.customer_id and c.c4 = t.c4 and c.c6 = t.c6""").iloc[0].round(3).to_dict()
pd.DataFrame(rules).T
'''),
md("""
**What it means.** No simple ordering rule reproduces the K labels (best is about 80%). So a `Card` vertex is keyed by (customer, network, type), and the
`Kn` label is kept as an **alias** learned from closed cases and the case pack. The answer files may only contain card IDs that exist in a source file,
so unresolved cards are described by their tuple in the evidence instead of being given an invented label.
"""),
md("""
## 10 · The 20 exam cases, using only what was known when each opened

For each case we compute the flagged transaction and the card's history **strictly before `opened_at`**: baseline amount, whether the product and region were
seen before, recent activity, and how widely the device profile is shared. These are observations to guide the design, **not verdicts**; there is no answer key.
"""),
code('''
def dossier(r):
    cust, as_of, tid = r.customer_id, r.opened_at, int(r.flagged_txn_id)
    ts, ch, prod, amt, addr1, c4, c6, rs = con.execute(
        "select ts, channel, prod, amt, addr1, card4, card6, risk_score from tx where TransactionID = ?", [tid]).fetchone()
    base = "customer_id = ? and coalesce(card4,'~') = ? and coalesce(card6,'~') = ? and ts <= ? and TransactionID <> ?"
    prm = [cust, c4 or "~", c6 or "~", as_of, tid]
    n, med, p95 = con.execute(f"select count(*), round(median(amt),1), round(quantile_cont(amt,0.95),1) from tx where {base}", prm).fetchone()
    prod_seen = con.execute(f"select count(*) from tx where {base} and prod = ?", prm + [prod]).fetchone()[0]
    reg_seen = con.execute(f"select count(*) from tx where {base} and addr1 = ?", prm + [addr1]).fetchone()[0] if addr1 is not None else None
    home = con.execute(f"select mode(addr1) from tx where {base} and channel = 'in_person'", prm).fetchone()[0]
    n48 = con.execute(f"select count(*) from tx where {base} and ts >= (?::timestamp - interval 48 hour)", prm + [as_of]).fetchone()[0]
    dv = con.execute("select dprof, id_15, id_23 from idn where TransactionID = ?", [tid]).fetchone()
    shared = con.execute("select count(distinct t.customer_id) from idn d join tx t using (TransactionID) where d.dprof = ? and t.ts <= ? and t.customer_id <> ?",
                         [dv[0], as_of, cust]).fetchone()[0] if dv else None
    return {"case": r.case_id, "trigger": r.trigger_type[:8], "score": rs, "channel": ch, "prod": prod, "amt": amt, "region": addr1, "home_region": home,
            "prior_txns": n, "median": med, "p95": p95, "amt_over_p95": (amt > p95) if p95 is not None else None,
            "prod_seen": prod_seen, "region_seen": reg_seen, "txns_48h": n48,
            "device_new": (dv[1] == "New") if dv else None, "proxy": (dv[2] or "") if dv else None, "device_shared_by": shared}

exam = pd.DataFrame([dossier(r) for r in q("select * from pack order by case_id").itertuples()])
exam
'''),
md("""
Three cases stand out on inspection (details for the reasoning are in `CLAUDE.md`):

- **HHG-006** – a customer report scored 0.25, but the same card made four purchases under $500 in 30 minutes. Structuring.
- **HHG-014** – an analyst request scored 0.05, on the ring fingerprint from section 7a.
- **HHG-018** – a customer report of a $39.08 charge that the card had already made seven times before. A recurring-charge candidate, but only after a coincidence test (this is an aggregate customer).
"""),
code('''
print("HHG-006: the four purchases before it opened")
q("""select strftime(ts,'%m-%d %H:%M') as at_time, amt, prod, addr1, risk_score from tx
    where customer_id = (select customer_id from pack where case_id='HHG-006') and channel='online'
      and ts between timestamp '2016-11-21 19:50:00' and timestamp '2016-11-21 20:40:00' order by ts""")
'''),
code('''
print("HHG-018: how often has this exact amount appeared before on this customer?")
q("""select strftime(ts,'%Y-%m-%d') as day_, amt, channel, addr1 from tx
    where customer_id = (select customer_id from pack where case_id='HHG-018') and amt = 39.08
      and ts <= (select opened_at from pack where case_id='HHG-018') order by ts""")
'''),
md("""
## 11 · What this changes in the design

| Finding | Consequence |
|---|---|
| Score is non-monotonic; cleared cases are all ≥ 0.81 | Score is one learned evidence class, never a threshold |
| Three known innocent explanations, none for customer reports | A **defence advocate** with graph tests (trip, device succession, recurring cadence) |
| A live ring at scores ≤ 0.44 | **Score-blind sweep** with device-rarity weighting |
| Structuring at low scores | **Threshold-hugging** signature and a novelty detector |
| Customers are aggregates | Per-card baselines and hub hygiene |
| Card labels not derivable | Alias table; emit only IDs that exist |
| Data continues after `opened_at` | `as_of` on every query, tested |

Next: `02_features_and_baseline_calibration.ipynb` measures how much graph features help, and writes the first likelihood-ratio table.
"""),
]

# --------------------------------------------------------------------------------------------------
# Notebook 2
# --------------------------------------------------------------------------------------------------
NB2 = [
md("""
# 02 · Features, backtest and baseline calibration

**Purpose.** Measure whether graph-derived features carry real signal, especially where the bank score is confused, and write the first
**likelihood-ratio table** the backend's judge can use.

**Method, in one paragraph.** For every closed case we take its first suspicious transaction and compute features **as of that transaction's
time** (nothing later). We split by time: train on cases opened before 1 October, test on October. Nothing from the test month is used to fit anything.

**Honesty note.** Closed history is 84% fraud, and its *innocent* cases were all score-triggered (score ≥ 0.8). Numbers here show that signal exists.
They are a starting point for calibration, not the final probabilities; see section 7.
"""),
md("## 1 · Setup"),
code(SETUP),
md("""
## 2 · As-of features for every closed case

Each case contributes one row: its first fraud transaction (or the single transaction for a cleared case). The features are the ones the agent's signatures use:

| feature | meaning |
|---|---|
| `new_dev` | identity record marks the device `New` |
| `proxy` | device is behind a proxy (`id_23`) |
| `dev_self0` | this card never used this device profile before |
| `dev_others_30d` | other customers on the same device profile in the last 30 days |
| `reg_new` | billing region never seen on this card |
| `prod_new` | product code never used on this card |
| `over_p95` | amount above the card's own 95th percentile |
| `amt_ratio` | log amount relative to the card's median |
| `burst_2h` | transactions on the card in the previous 2 hours |
| `hub` | card with an implausible volume for one person |

All history is strictly **before** the case's transaction time.
"""),
code('''
have = con.execute("select count(*) from information_schema.tables where table_name = 'fx'").fetchone()[0]
if not have:
    con.execute("""
    create table fx as
    with f as (
      select cc.case_id, cc.outcome, cc.pattern, cc.opened_at, t.TransactionID tid, t.customer_id, t.ts, t.channel, t.amt, t.prod, t.addr1,
             t.risk_score rs, coalesce(t.card4,'~') c4, coalesce(t.card6,'~') c6
      from (select *, coalesce(first_fraud_txn_id, split_part(txn_ids,'|',1)::bigint) ftid from cc) cc
      join tx t on t.TransactionID = cc.ftid)
    select f.*,
      (select count(*) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts) n_prior,
      (select coalesce(median(h.amt),0) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts) med_prior,
      (select coalesce(quantile_cont(h.amt,0.95),0) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts) p95_prior,
      (select count(*) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts and h.prod=f.prod) n_prod_seen,
      (select count(*) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts and h.addr1=f.addr1) n_reg_seen,
      (select count(*) from tx h where h.customer_id=f.customer_id and coalesce(h.card4,'~')=f.c4 and coalesce(h.card6,'~')=f.c6 and h.ts<f.ts and h.ts>=f.ts-interval 2 hour) n_2h
    from f""")
    con.execute("""
    create table fx2 as
    select fx.*, d.id_15, d.id_23, d.dprof,
      (select count(*) from idn d2 join tx t2 using (TransactionID) where d2.dprof=d.dprof and t2.customer_id=fx.customer_id and t2.ts<fx.ts) dev_prior_self,
      (select count(distinct t2.customer_id) from idn d2 join tx t2 using (TransactionID) where d2.dprof=d.dprof and t2.customer_id<>fx.customer_id and t2.ts<fx.ts and t2.ts>=fx.ts-interval 30 day) dev_others_30d
    from fx left join idn d on d.TransactionID = fx.tid""")
df = q("select * from fx2")
df["y"] = (df.outcome == "confirmed_fraud").astype(int)
df["online"] = (df.channel == "online").astype(int)
df["amt_ratio"] = np.log1p(df.amt) - np.log1p(df.med_prior)
df["over_p95"] = (df.amt > df.p95_prior).astype(int)
df["prod_new"] = (df.n_prod_seen == 0).astype(int)
df["reg_new"] = ((df.n_reg_seen == 0) & df.addr1.notna()).astype(int)
df["new_dev"] = (df.id_15 == "New").astype(int)
df["proxy"] = df.id_23.fillna("").str.contains("PROXY").astype(int)
df["dev_self0"] = (df.dprof.notna() & (df.dev_prior_self == 0)).astype(int)
df["dev_others"] = np.log1p(df.dev_others_30d.fillna(0))
df["hub"] = (df.n_prior > 3000).astype(int)
df["logn"] = np.log1p(df.n_prior)
df["burst_2h"] = np.log1p(df.n_2h)
df["rs"] = df.rs.astype(float)
print(len(df), "closed cases;", int(df.y.sum()), "fraud,", int((1 - df.y).sum()), "cleared")
'''),
md("""
## 3 · Fraud versus false alarm, feature by feature

How different are the two groups on each feature? (Mean of a 0/1 feature is the share of cases where it is true.)
"""),
code('''
FEATS = ["rs", "online", "amt_ratio", "over_p95", "prod_new", "reg_new", "new_dev", "proxy", "dev_self0", "dev_others", "hub", "logn", "burst_2h"]
df.groupby("outcome")[FEATS].mean().T.round(3)
'''),
md("""
## 4 · The backtest: score alone, graph alone, both

Train on cases opened **before 1 October 2016**, test on **October**. Metric: ROC AUC (how well the model ranks fraud above false alarm) and Brier score (probability accuracy).
We use gradient boosting only as a *measuring stick* for how much signal there is; the production judge stays a transparent log-odds ledger.
"""),
code('''
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score, brier_score_loss

tr, te = df[df.opened_at < "2016-10-01"], df[df.opened_at >= "2016-10-01"]
print(f"train {len(tr)} cases, test {len(te)} cases, test fraud share {te.y.mean():.3f}")

def fit_eval(cols, data_tr, data_te):
    m = GradientBoostingClassifier(n_estimators=150, max_depth=3, random_state=0).fit(data_tr[cols], data_tr.y)
    p = m.predict_proba(data_te[cols])[:, 1]
    return round(roc_auc_score(data_te.y, p), 3), round(brier_score_loss(data_te.y, p), 3)

GRAPH = [f for f in FEATS if f != "rs"]
rows = [("risk score only", *fit_eval(["rs"], tr, te)),
        ("graph features only (no score)", *fit_eval(GRAPH, tr, te)),
        ("score + graph features", *fit_eval(FEATS, tr, te))]
pd.DataFrame(rows, columns=["model", "AUC", "Brier"])
'''),
md("""
### Careful: why "score only" looks good here

Because every cleared case has a score of 0.8 or more while fraud is spread out, the score *appears* to separate the groups in this sample. That is a property of how the sample was
made, not proof that the score is a good detector. The fair test is the next one: inside the zone where **both** kinds of case exist.
"""),
code('''
zone_tr, zone_te = tr[tr.rs >= 0.8], te[te.rs >= 0.8]
print(f"zone score >= 0.8: train {len(zone_tr)}, test {len(zone_te)}, test fraud share {zone_te.y.mean():.3f}")
pd.DataFrame([
    ("risk score only", *fit_eval(["rs"], zone_tr, zone_te)),
    ("graph features only", *fit_eval(GRAPH, zone_tr, zone_te)),
    ("score + graph features", *fit_eval(FEATS, zone_tr, zone_te)),
], columns=["model (score >= 0.8 only)", "AUC", "Brier"])
'''),
md("""
**What it means.** Inside the high-score zone (where the bank is confused: roughly half the alerts are false alarms) the score alone is close to useless, and graph
features carry most of the signal. That is the case for a graph-first agent.
"""),
md("""
## 5 · Do the anonymous Vesta columns carry signal?

The `C`, `D`, `M` and `V` columns have no names, but they are real model features. We test them at the *transaction* level: labelled fraud transactions versus cleared plus a random
sample of unlabelled ones. Evidence based on them must say "engineered features, unnamed", never pretend to know what `V127` means.
"""),
code('''
DATA = DATA_DIR.as_posix()
cols = [f"C{i}" for i in range(1, 15)] + [f"D{i}" for i in range(1, 16)] + [f"V{i}" for i in range(1, 340)] + [f"M{i}" for i in range(1, 10)]
sel = ", ".join(f'r."{c}"' for c in cols)
con.execute("create or replace temp table sample_ids as "
            "select tid as TransactionID, 1 y from lab where outcome='confirmed_fraud' union all "
            "select tid, 0 from lab where outcome='cleared' union all "
            "select TransactionID, 0 from (select t.TransactionID from tx t left join lab l on l.tid=t.TransactionID "
            "where l.tid is null and t.risk_score < 0.8 using sample 40000 rows)")
vf = con.execute(f"""select s.y, t.ts, t.risk_score, t.amt, {sel}
    from sample_ids s join tx t using (TransactionID)
    join read_csv('{DATA}/transactions.csv', header=true, sample_size=200000) r on r.TransactionID = s.TransactionID""").df()
for m in [f"M{i}" for i in (1,2,3,5,6,7,8,9)]:
    vf[m] = vf[m].map({"T": 1, "F": 0}).astype(float)
vf["M4"] = vf["M4"].map({"M0": 0, "M1": 1, "M2": 2}).astype(float)
X = [c for c in cols if c in vf.columns]
vtr, vte = vf[vf.ts < "2016-10-01"], vf[vf.ts >= "2016-10-01"]

def auc(cols_):
    m = GradientBoostingClassifier(n_estimators=100, max_depth=3, subsample=0.5, random_state=0).fit(vtr[cols_].fillna(-1), vtr.y)
    return round(roc_auc_score(vte.y, m.predict_proba(vte[cols_].fillna(-1))[:, 1]), 3)

pd.DataFrame([("C/D/M/V only", auc(X)), ("score + amount", auc(["risk_score", "amt"])), ("everything", auc(X + ["risk_score", "amt"]))],
             columns=["features", "AUC (October)"])
'''),
md("""
**What it means.** The unnamed features add real signal on top of score and amount, so a *numeric lookalike* channel (nearest neighbours in a compressed feature space)
is worth building, as one clearly labelled evidence class.
"""),
md("""
## 6 · The first likelihood-ratio table

For each binary signal we estimate, **inside the zone where both outcomes exist**:

`LR(present) = P(signal | fraud) / P(signal | cleared)`   and   `LR(absent) = P(no signal | fraud) / P(no signal | cleared)`

Three safeguards, all deliberate:
1. **Smoothing** (+1 pseudo-count) so small samples cannot give infinite ratios.
2. **Shrinkage** (multiply the log-ratio by 0.5) because history is not the exam.
3. **Cap** at ±log(5) so no single signal can dominate.

Because ratios are class-conditional they are *not* affected by the 84% fraud base rate; the **prior** (about 50% for the exam) is applied separately by the judge.
"""),
code('''
import json, math   # math is used again in section 6b
SIGNALS = {"new_dev": "new_device", "proxy": "proxy", "dev_self0": "device_unseen_by_card", "reg_new": "new_region", "prod_new": "new_product", "over_p95": "amount_over_p95"}
SHRINK, CAP = 0.5, math.log(5)

def lr_table(data):
    fz, cz = data[data.y == 1], data[data.y == 0]
    out = {}
    for col, name in SIGNALS.items():
        pf = (fz[col].sum() + 1) / (len(fz) + 2)
        pc = (cz[col].sum() + 1) / (len(cz) + 2)
        f = lambda x: float(np.clip(SHRINK * x, -CAP, CAP))
        out[name] = {"p_given_fraud": round(pf, 4), "p_given_cleared": round(pc, 4),
                     "log_lr_present": round(f(math.log(pf / pc)), 4), "log_lr_absent": round(f(math.log((1 - pf) / (1 - pc))), 4),
                     "n_fraud": int(len(fz)), "n_cleared": int(len(cz))}
    return out

table = lr_table(zone_tr)                     # fitted on training months only
pd.DataFrame(table).T[["p_given_fraud", "p_given_cleared", "log_lr_present", "log_lr_absent"]]
'''),
md("""
### Does it generalise? Check on the held-out month

Score every October in-zone case by summing the matching log-ratios (a naive-Bayes ledger, the same idea as the production judge) and measure AUC.
"""),
code('''
def ledger_score(row):
    s = 0.0
    for col, name in SIGNALS.items():
        s += table[name]["log_lr_present"] if row[col] else table[name]["log_lr_absent"]
    return s

zone_te = zone_te.copy()
zone_te["ledger"] = zone_te.apply(ledger_score, axis=1)
print("held-out AUC of the transparent ledger (score >= 0.8 zone):", round(roc_auc_score(zone_te.y, zone_te.ledger), 3))
print("for comparison, the bank score alone in the same zone:      ", round(roc_auc_score(zone_te.y, zone_te.rs), 3))
'''),
code('''
out = {
    "version": "baseline_v0",
    "note": "Estimated within the score>=0.8 zone (only place both outcomes exist). Fitted on cases opened before 2016-10-01. Shrunk by 0.5, capped at log(5). Prior is applied separately by the judge.",
    "zone": "risk_score >= 0.8",
    "signals": table,
}
path = ROOT / "calibration" / "baseline_v0.json"
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(out, indent=2))
print("wrote", path)
'''),
md("""
## 6b · A warning hidden in that table: in this zone, "suspicious-looking" means innocent

Look at the signs. Inside the high-score zone, `new_device`, `new_region` and `device_unseen_by_card` all have **negative** log-ratios: they are *more* common among the
false alarms than among the fraud. That is the opposite of what a naive fraud rule assumes. Two explanations to rule out: (a) a mix effect (most fraud in this zone might be
in-person, where devices do not exist) and (b) something real about how false alarms look. We stratify by channel to separate them.
"""),
code('''
z = df[df.rs >= 0.8]
print("who is in the zone:")
display(pd.crosstab(z.channel, z.outcome))
rows = []
for ch in ["online", "in_person"]:
    s = z[z.channel == ch]
    f, c = s[s.y == 1], s[s.y == 0]
    for col in ["new_dev", "reg_new", "prod_new", "over_p95"]:
        pf, pc = (f[col].sum() + 1) / (len(f) + 2), (c[col].sum() + 1) / (len(c) + 2)
        rows.append({"channel": ch, "signal": col, "P(signal | fraud)": round(pf, 3), "P(signal | cleared)": round(pc, 3),
                     "raw log-LR when present": round(math.log(pf / pc), 2), "fraud n": len(f), "cleared n": len(c)})
pd.DataFrame(rows)
'''),
md("""
**What it means.** The sign does *not* flip when we split by channel. Among **online** alerts scoring 0.8 or higher, 98% of the cleared cases show a `New` device against 36% of the fraud.
In this zone the false alarms are the cases that *look* the most suspicious on naive signals (a new phone, a new region, an unusual amount), and the confirmed fraud is comparatively ordinary.
This matches the README: "above 0.7, most flagged transactions turn out to be legitimate".

**Consequence for the agent.** A signal's meaning depends on the bank score around it. Below 0.8, a new device is evidence of fraud (74% of confirmed new-device fraud); at 0.8 and above, it is
evidence of a new phone. So the backend has two signatures: `new_device` (score under 0.8, prosecution, positive) and `new_device_at_high_score` (0.8 and above, defence, negative, equal to the
`new_device` value in `baseline_v0.json`). Additive evidence classes cannot express that interaction on their own, which is why the score zone is used to *select* the signature.

*Caveat.* Below 0.8 there are no cleared cases in history, so we cannot measure the innocent side there; the positive weight outside the zone is a reasoned default, to be checked by the backtest.
"""),
md("""
## 7 · Limits, and what comes next

- **Population.** Innocent history is only score-triggered alerts, so these ratios say nothing about customer-report cases. Those rely on rule-based defence tests.
- **Selection.** Only investigated transactions have labels; un-cased transactions are not proven innocent (the ring proves that).
- **Prior shift.** The judge must reset the prior to the exam's mix (about half legitimate) and never train on raw class frequency.
- **No tuning on the exam.** The 20 exam cases were never used here.

**Next step in the backend:** the judge loads `calibration/baseline_v0.json` where signal names match, and otherwise falls back to hand-set defaults. The full backtest
(replaying closed cases through the whole agent) replaces this baseline once the agent runs end to end.
"""),
]


def build(cells, path: Path):
    nb = nbf.v4.new_notebook()
    nb.cells = cells
    nb.metadata["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
    path.parent.mkdir(parents=True, exist_ok=True)
    nbf.write(nb, path)
    return nb


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    a = ap.parse_args()
    books = {"01_dataset_understanding.ipynb": NB1, "02_features_and_baseline_calibration.ipynb": NB2}
    for name, cells in books.items():
        p = NB_DIR / name
        nb = build(cells, p)
        if a.execute:
            print("executing", name, flush=True)
            NotebookClient(nb, timeout=1800, kernel_name="python3", resources={"metadata": {"path": str(NB_DIR)}}).execute()
            nbf.write(nb, p)
        print("wrote", p)
