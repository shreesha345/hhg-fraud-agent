# Synthetic test dataset

**Everything in this folder is invented.** It is not the hackathon data and contains no real transactions. It exists so the backend can be tested quickly and deterministically without TigerGraph and without loading the 708 MB `transactions.csv`.

It mirrors the *shape* of the real files, slimmed to the columns the agent uses, and plants **eight scenarios** whose correct handling follows the fraud policy in `../README.md`. `expected.json` was written from the policy, **not** from the agent's output, and the end-to-end tests check the agent against it.

Regenerate (deterministic, seed 42): `cd py && uv run python scripts/make_test_dataset.py`

## Files

| File | Rows | Schema |
|---|---|---|
| `transactions.csv` | ~4,350 | `TransactionID, customer_id, ts, channel, risk_score, TransactionAmt, ProductCD, card4, card6, addr1, addr2, P_emaildomain, R_emaildomain` |
| `identity.csv` | ~1,150 | `TransactionID, DeviceType, DeviceInfo, id_15, id_23, id_30, id_31, id_33` |
| `closed_cases_history.csv` | 12 | same columns as the real file |
| `case_pack.csv` | 8 | same columns as the real file |
| `expected.json` | 8 | what a correct agent must do, per case |

IDs are deliberately different from the real data (`TransactionID` from 9,000,001; customers `T0001…`; cases `TST-…` and `CC-T…`) so the two can never be confused. The real-data slim export (`data/slim/`, from `py/scripts/export_slim.py`) has the same schema, so the backend runs on either by changing `DATASET_DIR`.

## The eight scenarios

| Case | Trigger, score | What is planted | Correct behaviour |
|---|---|---|---|
| TST-001 | risk score 0.62 | Four sub-$5 online authorizations within 40 minutes, then a $259.98 purchase | Card testing. R5: decline and step-up; a purchase over $100 cleared so block (L1) |
| TST-002 | customer report, no score | Four purchases just under $500 in 30 minutes ($1,906.07) | Undocumented (threshold structuring). R2 + R9: block (L1), create case, report (L2), escalate |
| TST-003 | analyst request, score 0.05 | One rare device, always New, behind an anonymous proxy, used by 13 customers | Undocumented ring. R6 + R9: report (L2), monitor connected cards, escalate. Bank score is irrelevant |
| TST-004 | risk score **0.91** | Five days in a new region while home spending stops | Legitimate (a trip). Never block. Tests that a high score can be innocent |
| TST-005 | customer report | A $39.08 charge repeating monthly, disputed by the customer | R7: verify and warn, never block; the assumed confirmation closes it |
| TST-006 | risk score **0.88** | A new phone replacing an old one of the same family, not shared | Legitimate. Tests the high-score-zone reading of a New device |
| TST-007 | risk score 0.57 | In-person use in a region never seen, while home spending continues | One weak signal, so R1: verify first. The assumed denial then triggers R2 |
| TST-008 | risk score 0.55 | Three off-profile online purchases from a device marked New that nobody else uses | Card-not-present with a new device; block after strong independent evidence |

## Built-in traps

- **Look-ahead.** The last ring customer (`T9112`) uses the ring device only *after* TST-003 opens. A correct agent must not see it; `connected_cards_exclude` checks this.
- **Generic devices.** Four common device profiles are shared by about ten background customers each. None may ever be called a ring.
- **Two-card customer.** `T0005` has two cards, to exercise card resolution.
- **Closed history.** Twelve closed cases: a September ring wave (confirmed, already blocked), two structuring cases, two cleared travel cases, one cleared new-phone case, one confirmed new-device fraud. Memory must recall by *shape*, and only cases already closed at the case's opening time.

## Using it in tests

```ts
import { loadTestStore, expected } from "./helpers";   // backend/tests/helpers.ts
```

Run `pnpm test` from the repo root.
