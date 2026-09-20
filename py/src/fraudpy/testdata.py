"""Synthetic test dataset for the fraud agent.

Everything here is invented. It mirrors the *shape* of the real HHGOA_IEEE files (slimmed to the columns
the agent uses) and plants eight scenarios whose correct handling follows the README policy, so the
backend can be tested without TigerGraph and without touching the real 708 MB file.

Deterministic: same seed, same files. Run via `py/scripts/make_test_dataset.py`.
"""
from __future__ import annotations

import csv
import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

FMT = "%Y-%m-%d %H:%M:%S"
START = datetime(2016, 7, 2, 0, 0, 0)

TX_COLS = [
    "TransactionID", "customer_id", "ts", "channel", "risk_score", "TransactionAmt", "ProductCD",
    "card4", "card6", "addr1", "addr2", "P_emaildomain", "R_emaildomain",
]
ID_COLS = ["TransactionID", "DeviceType", "DeviceInfo", "id_15", "id_23", "id_30", "id_31", "id_33"]
CC_COLS = [
    "case_id", "customer_id", "card_id", "opened_at", "closed_at", "outcome", "pattern", "first_fraud_txn_id",
    "txn_ids", "n_txns", "exposure_usd", "connected_card_ids", "actions_taken", "report_filed", "analyst_notes",
]
PACK_COLS = [
    "case_id", "opened_at", "trigger_type", "trigger_text", "flagged_txn_id", "card_id", "customer_id", "risk_score",
]

# device profile = DeviceInfo | id_30 | id_31 | id_33  (README definition)
@dataclass(frozen=True)
class Dev:
    device_type: str
    device_info: str
    os: str
    browser: str
    screen: str
    proxy: str = ""

GENERIC = [
    Dev("desktop", "Windows", "Windows 10", "chrome 65.0", "1920x1080"),
    Dev("desktop", "Windows", "Windows 7", "ie 11.0 for desktop", "1366x768"),
    Dev("mobile", "iOS Device", "iOS 11.2.1", "mobile safari 11.0", "2208x1242"),
    Dev("mobile", "SM-G610F Build/NRD90M", "Android 7.0", "chrome 63.0 for android", "1920x1080"),
]
RING = Dev("mobile", "SM-G935F Build/NRD90M", "Android 7.0", "chrome 62.0 for android", "1920x1080", "IP_PROXY:ANONYMOUS")
OLD_IPHONE = Dev("mobile", "iOS Device", "iOS 9.3.5", "mobile safari 9.0", "1024x768")
NEW_IPHONE = Dev("mobile", "iOS Device", "iOS 10.3.3", "mobile safari 10.0", "1334x750")
NEW_IPHONE_B = Dev("mobile", "iOS Device", "iOS 10.2.1", "mobile safari 10.0", "1136x640")  # a different customer's new phone
ONE_OFF_A = Dev("mobile", "SM-J700M Build/MMB29K", "Android 6.0.1", "chrome 63.0 for android", "1280x720")
ONE_OFF_B = Dev("mobile", "LG-H870 Build/NRD90U", "Android 7.0", "chrome 64.0 for android", "1440x2880")
ONE_OFF_C = Dev("mobile", "XT1635-02 Build/NPN25.137-35", "Android 7.0", "chrome 65.0 for android", "1080x1920")

HOME_REGIONS = [204, 264, 272, 299, 300, 325, 330]


def profile(d: Dev) -> str:
    return f"{d.device_info} | {d.os} | {d.browser} | {d.screen}"


@dataclass
class World:
    rng: random.Random
    rows: list[dict] = field(default_factory=list)
    ids: list[dict] = field(default_factory=list)
    next_id: int = 9_000_001
    seen_dev: set = field(default_factory=set)

    def txn(self, cust: str, card4: str, card6: str, ts: datetime, amt: float, prod: str, region: int | None,
            score: float | None = None, dev: Dev | None = None, note_new: bool | None = None) -> int:
        tid = self.next_id
        self.next_id += 1
        online = prod != "W"
        if score is None:
            score = round(min(0.99, self.rng.betavariate(1.2, 7.0)), 2)
        self.rows.append({
            "TransactionID": tid, "customer_id": cust, "ts": ts.strftime(FMT),
            "channel": "online" if online else "in_person", "risk_score": f"{score:.2f}",
            "TransactionAmt": f"{amt:.2f}", "ProductCD": prod, "card4": card4, "card6": card6,
            "addr1": "" if region is None else f"{region}.0", "addr2": "87.0" if region is not None else "",
            "P_emaildomain": self.rng.choice(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com"]) if online else "",
            "R_emaildomain": "",
        })
        if online and dev is not None:
            key = (cust, profile(dev))
            is_new = note_new if note_new is not None else key not in self.seen_dev
            self.seen_dev.add(key)
            self.ids.append({
                "TransactionID": tid, "DeviceType": dev.device_type, "DeviceInfo": dev.device_info,
                "id_15": "New" if is_new else "Found", "id_23": dev.proxy,
                "id_30": dev.os, "id_31": dev.browser, "id_33": dev.screen,
            })
        return tid


def _history(w: World, cust: str, card4: str, card6: str, home: int, n: int, dev: Dev, *,
             start: datetime = START, end: datetime = datetime(2016, 11, 20), online_share: float = 0.25,
             med: float = 55.0) -> list[int]:
    """Ordinary spend: mostly in-person at the home region, some online with the customer's usual device."""
    out = []
    span = (end - start).total_seconds()
    times = sorted(start + timedelta(seconds=w.rng.random() * span) for _ in range(n))
    for t in times:
        amt = round(max(2.0, w.rng.lognormvariate(0, 0.6) * med), 2)
        if w.rng.random() < online_share:
            out.append(w.txn(cust, card4, card6, t, amt, w.rng.choice(["C", "C", "R"]), None, dev=dev))
        else:
            out.append(w.txn(cust, card4, card6, t, amt, "W", home))
    return out


def build(out_dir: Path, seed: int = 42) -> dict:
    rng = random.Random(seed)
    w = World(rng=rng)
    closed: list[dict] = []
    pack: list[dict] = []
    expected: dict = {}

    # ---- background population: 40 customers, generic devices (so generic fingerprints are common) ----
    for i in range(1, 41):
        cust = f"T{i:04d}"
        card4 = rng.choice(["visa", "mastercard"])
        card6 = rng.choice(["credit", "debit"])
        home = rng.choice(HOME_REGIONS)
        dev = GENERIC[i % len(GENERIC)]
        _history(w, cust, card4, card6, home, rng.randint(60, 90), dev)
        if i == 5:  # a customer with two cards, to exercise card resolution
            _history(w, cust, "mastercard", "debit" if card6 == "credit" else "credit", home, 30, dev)

    def closed_case(cid: str, cust: str, card_id: str, opened: datetime, outcome: str, pattern: str, txns: list[int],
                    amount: float, connected: list[str], actions: str, report: bool, notes: str, days: int = 3):
        closed.append({
            "case_id": cid, "customer_id": cust, "card_id": card_id, "opened_at": opened.strftime(FMT),
            "closed_at": (opened + timedelta(days=days)).strftime(FMT), "outcome": outcome, "pattern": pattern,
            "first_fraud_txn_id": txns[0] if outcome == "confirmed_fraud" else "",
            "txn_ids": "|".join(str(t) for t in txns), "n_txns": len(txns),
            "exposure_usd": f"{amount:.2f}" if outcome == "confirmed_fraud" else "0.00",
            "connected_card_ids": "|".join(connected), "actions_taken": actions,
            "report_filed": "Yes" if report else "No", "analyst_notes": f"Case {cid}: {notes}",
        })

    # ---- ring victims: 12 customers share one rare fingerprint (New + anonymous proxy) ----
    ring_customers = [f"T91{i:02d}" for i in range(1, 13)]
    ring_cards = {c: f"{c}-K1" for c in ring_customers}
    for j, c in enumerate(ring_customers):
        home = HOME_REGIONS[j % len(HOME_REGIONS)]
        _history(w, c, "visa", "debit" if j % 2 else "credit", home, 40, GENERIC[j % len(GENERIC)], end=datetime(2016, 11, 10))
        if j < 6:   # September wave: confirmed, blocked, closed
            t0 = datetime(2016, 9, 12 + j, 15, 0) + timedelta(minutes=7 * j)
            t = [w.txn(c, "visa", "debit" if j % 2 else "credit", t0 + timedelta(minutes=9 * k), round(95 + 20 * k + j, 2), "C", None,
                       score=round(0.10 + 0.05 * k, 2), dev=RING, note_new=True) for k in range(3)]
            closed_case(f"CC-T{100 + j}", c, ring_cards[c], t0 + timedelta(hours=5), "confirmed_fraud", "undocumented", t,
                        sum(float(r["TransactionAmt"]) for r in w.rows if r["TransactionID"] in t),
                        [ring_cards[x] for x in ring_customers if x != c], "CREATE_CASE|BLOCK_CARD|FILE_REPORT", True,
                        "cardholder reported online purchases they did not make. The purchases came from an Android device "
                        "behind an anonymous proxy, a device never seen on this account. Other cardholders reported the same "
                        "device profile. Pattern not matched to a documented typology. Card blocked and reissued.")
        else:       # November wave: live, never flagged, low scores
            for k in range(2):
                w.txn(c, "visa", "debit" if j % 2 else "credit", datetime(2016, 11, 14 + 2 * (j - 6) + k, 16, 30 + 5 * k), round(80 + 25 * k + j, 2),
                      "C", None, score=round(0.04 + 0.05 * k + 0.01 * (j - 6), 2), dev=RING, note_new=True)

    # ---- structuring history: two September closed cases (four purchases just under $500) ----
    for n, c in enumerate(["T9201", "T9202"]):
        _history(w, c, "mastercard", "debit", HOME_REGIONS[n], 45, GENERIC[n], end=datetime(2016, 9, 10))
        t0 = datetime(2016, 9, 20 + n, 15, 0)
        amts = [491.36, 476.88, 468.58, 468.39] if n == 0 else [482.23, 465.17, 470.39, 481.51]
        tx = [w.txn(c, "mastercard", "debit", t0 + timedelta(minutes=9 * k), a, "C", None, score=round(0.2 + 0.04 * k, 2), dev=GENERIC[n]) for k, a in enumerate(amts)]
        closed_case(f"CC-T{200 + n}", c, f"{c}-K1", t0 + timedelta(hours=4), "confirmed_fraud", "undocumented", tx, sum(amts), [],
                    "CREATE_CASE|BLOCK_CARD|FILE_REPORT", True,
                    "cardholder reported four online purchases within forty minutes, each just under $500, none of which they made. "
                    "Amounts appear chosen to stay under a $500 authorization threshold. Pattern not matched to a documented typology. Card blocked and reissued.")

    # ---- a few ordinary closed cases for memory (travel and new-phone false alarms, one CNP fraud) ----
    for n in range(4):
        c = f"T93{n:02d}"
        home = HOME_REGIONS[n]
        _history(w, c, "visa", "credit", home, 50, GENERIC[n], end=datetime(2016, 9, 1))
        t0 = datetime(2016, 9, 3 + n, 11, 0)
        if n < 2:
            tx = [w.txn(c, "visa", "credit", t0, 310.0 + n, "W", 888 + n, score=0.90)]
            closed_case(f"CC-T{300 + n}", c, f"{c}-K1", t0 + timedelta(hours=2), "cleared", "none", tx, 0.0, [],
                        "VERIFY_WITH_CUSTOMER|CLOSE_NO_FRAUD", False,
                        f"model scored a $310 transaction at 0.90. Cardholder confirmed travel to the billing region in question. Alert cleared.")
        elif n == 2:
            tx = [w.txn(c, "visa", "credit", t0, 140.0, "R", None, score=0.86, dev=NEW_IPHONE_B)]
            closed_case(f"CC-T{300 + n}", c, f"{c}-K1", t0 + timedelta(hours=2), "cleared", "none", tx, 0.0, [],
                        "VERIFY_WITH_CUSTOMER|CLOSE_NO_FRAUD", False,
                        "model scored a $140 transaction at 0.86. Cardholder confirmed the purchase from a new phone. Device added to profile. Alert cleared.")
        else:
            tx = [w.txn(c, "visa", "credit", t0 + timedelta(minutes=20 * k), 210.0 + 30 * k, "C", None, score=0.5, dev=ONE_OFF_B) for k in range(2)]
            closed_case(f"CC-T{300 + n}", c, f"{c}-K1", t0 + timedelta(hours=5), "confirmed_fraud", "card_not_present_new_device", tx, 450.0, [],
                        "CREATE_CASE|BLOCK_CARD", False,
                        "cardholder reported unrecognized activity. Online purchases from a device marked New for this account. Card blocked and reissued.")

    # =========================================================================
    # The eight exam-style scenarios
    # =========================================================================
    def add_pack(cid, opened, trig, text, flagged, cust, card, score):
        pack.append({"case_id": cid, "opened_at": opened.strftime(FMT), "trigger_type": trig, "trigger_text": text,
                     "flagged_txn_id": flagged, "card_id": card, "customer_id": cust, "risk_score": "" if score is None else f"{score:.2f}"})

    # TST-001 card testing, then a purchase above $100 clears
    c = "T9001"; _history(w, c, "visa", "credit", 300, 60, GENERIC[0])
    d = GENERIC[3]
    t = datetime(2016, 12, 5, 1, 10)
    seq = [w.txn(c, "visa", "credit", t + timedelta(minutes=13 * k), a, "C", None, score=0.20, dev=ONE_OFF_A) for k, a in enumerate([1.10, 2.40, 0.95, 3.20])]
    flagged = w.txn(c, "visa", "credit", datetime(2016, 12, 5, 2, 30), 259.98, "R", None, score=0.62, dev=ONE_OFF_A)
    add_pack("TST-001", datetime(2016, 12, 5, 3, 15), "risk_score", "Real-time model scored transaction %d ($259.98, online) at 0.62. Review and decide." % flagged, flagged, c, f"{c}-K1", 0.62)
    expected["TST-001"] = {"pattern": "card_testing", "verdict": "fraud", "affected": seq + [flagged],
                           "exposure": round(1.10 + 2.40 + 0.95 + 3.20 + 259.98, 2),
                           "initial_has": ["DECLINE_TRANSACTION", "STEP_UP_AUTH"], "final_has": ["BLOCK_CARD"], "final_hasnt": ["BLOCK_ALL_CARDS"],
                           "why": "R5: three or more small online auths within an hour then a larger purchase; a purchase over $100 cleared so block"}

    # TST-002 structuring: four purchases just under $500, customer report, low bank score
    c = "T9002"; _history(w, c, "mastercard", "debit", 264, 55, GENERIC[1], med=45.0)
    t = datetime(2016, 11, 21, 20, 0)
    amts = [478.95, 456.96, 488.04, 482.12]
    seq = [w.txn(c, "mastercard", "debit", t + timedelta(minutes=m), a, "C", None, score=s, dev=GENERIC[1])
           for m, a, s in zip([0, 10, 24, 30], amts, [0.26, 0.14, 0.12, 0.25])]
    add_pack("TST-002", datetime(2016, 11, 22, 2, 30), "customer_report",
             "Customer T9002 message: 'I never made this $482.12 purchase. Please check my card.' Refers to %d." % seq[-1], seq[-1], c, f"{c}-K1", None)
    expected["TST-002"] = {"pattern": "undocumented", "verdict": "fraud", "affected": seq, "exposure": round(sum(amts), 2),
                           "initial_has": ["CREATE_CASE", "BLOCK_CARD", "FILE_REPORT", "ESCALATE_TO_ANALYST"], "final_has": ["CREATE_CASE", "BLOCK_CARD", "FILE_REPORT"],
                           "routes": {"BLOCK_CARD": "L1", "FILE_REPORT": "L2"},
                           "why": "R2 (customer denies) plus R9 (undocumented threshold structuring); exposure 1906.07 > 1000 so report, <= 2500 so L1 block"}

    # TST-003 ring: analyst request, bank score almost zero
    c = "T9003"; _history(w, c, "visa", "credit", 272, 45, GENERIC[2], end=datetime(2016, 11, 10))
    w.txn(c, "visa", "credit", datetime(2016, 11, 15, 20, 30), 112.37, "C", None, score=0.10, dev=RING, note_new=True)
    flagged = w.txn(c, "visa", "credit", datetime(2016, 11, 22, 16, 11), 74.96, "C", None, score=0.05, dev=RING, note_new=True)
    add_pack("TST-003", datetime(2016, 11, 22, 20, 11), "analyst_request",
             "Analyst request: several cards this month show purchases from the same unusual device profile. Review transaction %d on card %s-K1 and look for related activity." % (flagged, c),
             flagged, c, f"{c}-K1", None)
    expected["TST-003"] = {"pattern": "undocumented", "verdict": "fraud",
                           "connected_cards_include": [ring_cards[x] for x in ring_customers[6:11]],
                           # T9112 only appears on the ring device AFTER this case opens: a correct agent must not see it
                           "connected_cards_exclude": [ring_cards[ring_customers[11]]],
                           "initial_has": ["CREATE_CASE", "FILE_REPORT", "ESCALATE_TO_ANALYST", "MONITOR_CONNECTED_CARDS"], "final_has": ["CREATE_CASE", "FILE_REPORT"],
                           "why": "R6 and R9: rare fingerprint (New, anonymous proxy) shared by many cards, bank score irrelevant"}

    # TST-004 travel: high bank score, but a multi-day stay in a new region while home activity stops
    c = "T9004"; _history(w, c, "visa", "credit", 300, 70, GENERIC[0], end=datetime(2016, 11, 24, 23, 0))
    for day, hrs in [(25, [9, 13, 18]), (26, [10, 14, 20]), (27, [8])]:
        for h in hrs:
            w.txn(c, "visa", "credit", datetime(2016, 11, day, h, 12), round(rng.uniform(20, 95), 2), "W", 555, score=0.30 if day > 25 else 0.91)
    flagged = w.txn(c, "visa", "credit", datetime(2016, 11, 27, 9, 40), 84.00, "W", 555, score=0.91)
    add_pack("TST-004", datetime(2016, 11, 27, 12, 0), "risk_score", "Real-time model scored transaction %d ($84.00, in billing region 555.0) at 0.91. Review and decide." % flagged, flagged, c, f"{c}-K1", 0.91)
    expected["TST-004"] = {"pattern": "none", "verdict_in": ["legitimate", "uncertain"], "final_has": ["CLOSE_NO_FRAUD"], "final_hasnt": ["BLOCK_CARD", "BLOCK_ALL_CARDS", "FILE_REPORT", "DECLINE_TRANSACTION"],
                           "initial_hasnt": ["BLOCK_CARD", "FILE_REPORT"],
                           "why": "score 0.91 is the false-alarm zone; consecutive days in the new region with home activity stopped is a trip, not a clone"}

    # TST-005 recurring charge disputed by the customer
    c = "T9005"; _history(w, c, "visa", "debit", 330, 70, GENERIC[0], end=datetime(2016, 12, 2), med=70.0)
    rec = []
    for m, d0 in [(7, 6), (8, 5), (9, 4), (10, 4), (11, 3)]:
        rec.append(w.txn(c, "visa", "debit", datetime(2016, m, d0, 10, 5), 39.08, "W", 330, score=0.10))
    flagged = w.txn(c, "visa", "debit", datetime(2016, 12, 3, 10, 3), 39.08, "W", 330, score=0.35)
    add_pack("TST-005", datetime(2016, 12, 3, 15, 0), "customer_report",
             "Customer T9005 message: 'I never made this $39.08 purchase. Please check my card.' Refers to %d." % flagged, flagged, c, f"{c}-K1", None)
    expected["TST-005"] = {"pattern": "none", "verdict_in": ["legitimate", "uncertain"], "initial_has": ["CREATE_CASE", "VERIFY_WITH_CUSTOMER", "WARN_CUSTOMER"], "final_has": ["CLOSE_NO_FRAUD"],
                           "final_hasnt": ["BLOCK_CARD", "FILE_REPORT"], "initial_hasnt": ["BLOCK_CARD"],
                           "why": "R7: the disputed charge repeats monthly at the same amount; verify and warn, never block"}

    # TST-006 new phone: device replaced, same brand, amount in profile
    c = "T9006"; _history(w, c, "mastercard", "credit", 299, 60, OLD_IPHONE, end=datetime(2016, 11, 20), online_share=0.5)
    w.txn(c, "mastercard", "credit", datetime(2016, 11, 20, 12, 0), 60.0, "R", None, score=0.08, dev=OLD_IPHONE)
    flagged = w.txn(c, "mastercard", "credit", datetime(2016, 11, 24, 18, 20), 96.5, "R", None, score=0.88, dev=NEW_IPHONE)
    add_pack("TST-006", datetime(2016, 11, 24, 21, 0), "risk_score", "Real-time model scored transaction %d ($96.50, online) at 0.88. Review and decide." % flagged, flagged, c, f"{c}-K1", 0.88)
    expected["TST-006"] = {"pattern": "none", "verdict_in": ["legitimate", "uncertain"], "final_has": ["CLOSE_NO_FRAUD"], "final_hasnt": ["BLOCK_CARD", "FILE_REPORT", "DECLINE_TRANSACTION"],
                           "initial_hasnt": ["BLOCK_CARD", "FILE_REPORT"],
                           "why": "new device replaces the old one for the same card (same brand, OS family), not shared with other cards, amount within profile"}

    # TST-007 out-of-region use while the cardholder keeps spending at home; single weak signal so verify first
    c = "T9007"; _history(w, c, "visa", "debit", 300, 80, GENERIC[0], end=datetime(2016, 11, 30, 23, 0), med=60.0)
    a = w.txn(c, "visa", "debit", datetime(2016, 12, 1, 14, 0), 220.0, "W", 777, score=0.57)
    b = w.txn(c, "visa", "debit", datetime(2016, 12, 1, 15, 50), 180.0, "W", 777, score=0.40)
    w.txn(c, "visa", "debit", datetime(2016, 12, 1, 15, 30), 41.0, "W", 300, score=0.05)
    add_pack("TST-007", datetime(2016, 12, 1, 17, 0), "risk_score", "Real-time model scored transaction %d ($220.00, in billing region 777.0) at 0.57. Review and decide." % a, a, c, f"{c}-K1", 0.57)
    expected["TST-007"] = {"pattern": "out_of_region_use", "verdict_in": ["fraud", "uncertain"], "affected_include": [a],
                           "initial_has": ["VERIFY_WITH_CUSTOMER"], "initial_hasnt": ["BLOCK_CARD", "BLOCK_ALL_CARDS"], "final_has": ["BLOCK_CARD", "CREATE_CASE"],
                           "why": "R1: one signal and p below 0.70 so verify before any block; assumed customer denial then triggers R2"}

    # TST-008 card-not-present burst from a new one-off device
    c = "T9008"; _history(w, c, "visa", "credit", 325, 60, GENERIC[0], end=datetime(2016, 12, 6), online_share=0.4, med=50.0)
    seq = [w.txn(c, "visa", "credit", datetime(2016, 12, 8, 9, 0) + timedelta(hours=k * 2), a_, "R", None, score=0.55, dev=ONE_OFF_C)
           for k, a_ in enumerate([220.0, 310.0, 180.0])]
    add_pack("TST-008", datetime(2016, 12, 8, 14, 30), "risk_score", "Real-time model scored transaction %d ($180.00, online) at 0.55. Review and decide." % seq[-1], seq[-1], c, f"{c}-K1", 0.55)
    expected["TST-008"] = {"pattern_in": ["card_not_present_fraud", "card_not_present_new_device"], "verdict_in": ["fraud", "uncertain"], "affected_include": seq,
                           "initial_hasnt": ["BLOCK_ALL_CARDS"], "final_hasnt": ["BLOCK_ALL_CARDS"],
                           "why": "three off-profile online purchases in six hours from a device marked New that no other card uses"}

    # ---------------------------------------------------------------- write
    out_dir.mkdir(parents=True, exist_ok=True)
    order = sorted(range(len(w.rows)), key=lambda i: (w.rows[i]["ts"], w.rows[i]["TransactionID"]))
    rows = [w.rows[i] for i in order]
    with open(out_dir / "transactions.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=TX_COLS); wr.writeheader(); wr.writerows(rows)
    with open(out_dir / "identity.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=ID_COLS); wr.writeheader(); wr.writerows(sorted(w.ids, key=lambda r: r["TransactionID"]))
    with open(out_dir / "closed_cases_history.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=CC_COLS); wr.writeheader(); wr.writerows(sorted(closed, key=lambda r: r["opened_at"]))
    with open(out_dir / "case_pack.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=PACK_COLS); wr.writeheader(); wr.writerows(pack)
    (out_dir / "expected.json").write_text(json.dumps(expected, indent=2), encoding="utf-8")
    return {"transactions": len(rows), "identity": len(w.ids), "closed_cases": len(closed), "pack": len(pack), "seed": seed}


if __name__ == "__main__":
    print(build(Path(__file__).resolve().parents[3] / "dataset" / "test"))
