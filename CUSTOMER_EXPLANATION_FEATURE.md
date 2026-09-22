# Customer-Friendly Explanation Feature

## Overview
Added a new feature that generates **simple, jargon-free explanations** of fraud investigations suitable for customers. This complements the technical analyst summary with plain language that anyone can understand.

## What Was Added

### 1. Backend Changes

#### `backend/src/llm/narrator.ts`
- **New method:** `explainToCustomer(brief: Brief)` 
- Generates 2-4 sentence explanation in simple language
- **Validation checks:**
  - No technical jargon (log-odds, signatures, prosecution, etc.)
  - All numbers must exist in the brief
  - Proper sentence count

**Example Output:**
```
"We noticed some unusual activity on your card that we need to review. 
A device we haven't seen before was used for several purchases. 
We're monitoring your account to make sure everything is okay."
```

#### `backend/src/agent/orchestrator.ts`
- Calls `narrator.explainToCustomer()` after generating analyst summary
- Gracefully handles failures (doesn't stop investigation if this fails)
- Adds `customer_explanation` to answer file

#### `shared/src/index.ts`
- Added `customer_explanation?: string` field to `CasePart` schema
- Optional field (won't break existing answer files)

### 2. Frontend Changes

#### `frontend/components/CustomerExplanation.tsx` (NEW)
- Displays customer explanation with appropriate icon
- Shows verdict-specific "Next Steps" guidance
- Clean, friendly UI with color-coded indicators:
  - 🔴 **Fraud:** Warning icon, explains monitoring/verification
  - 🟢 **Legitimate:** Checkmark, confirms no action needed
  - 🟡 **Uncertain:** Info icon, explains verification process

#### `frontend/components/Verdict.tsx`
- Integrates `CustomerExplanation` component
- Shows above the technical analyst summary
- Only displays if `customer_explanation` exists

## Key Design Principles

### ✅ What It Does
1. **Math decides** → Fraud probability, pattern, actions (unchanged)
2. **LLM explains** → Converts technical findings to plain English
3. **Validates output** → Numbers must match, no jargon allowed
4. **Graceful fallback** → Investigation continues even if explanation fails

### ❌ What It DOESN'T Do
- **Doesn't make decisions** (still pure math)
- **Doesn't change fraud probability**
- **Doesn't add/remove actions**
- **Doesn't invent data**

## How It Works

```typescript
// 1. Math detects patterns
const signatures = await runSignatures(ctx, store);  // Pure math

// 2. Judge calculates probability  
const assessment = judge(signatures);  // Pure math

// 3. Policy decides actions
const actions = decide(policyInput);  // Pure math rules

// 4. LLM writes THREE types of text (all validated):
const analystSummary = await narrator.explain(brief);     // For analysts
const sarNarrative = await narrator.sar(brief);           // For regulators
const customerText = await narrator.explainToCustomer(brief);  // For customers ← NEW!
```

## Example Comparison

### Technical Summary (Analyst)
```
"Device profile SM-G935F Build/NRD90M is shared by 44 customers, 
marked New on 100% of uses behind anonymous proxies. Matches pattern 
from 4 confirmed fraud cases. Probability: 0.94. Recommended: monitor 
connected cards, escalate to analyst, file regulator report."
```

### Customer Explanation (NEW)
```
"We're reviewing some unusual activity on your card. The purchases came 
from a device we haven't seen you use before, and similar patterns have 
appeared on other accounts. We'll contact you if we need to verify these 
transactions."
```

## Running With Customer Explanations

### Quick Test
```bash
pnpm install
pnpm test
pnpm dev:backend  # Start API (includes customer explanations)
pnpm dev:frontend # View in browser at localhost:3000
```

### Generate Answer Files With Explanations
```bash
# Test data
pnpm run:cases -- --out data/out-test

# Real data  
DATASET_DIR=data/slim pnpm run:cases -- --out cases

# TigerGraph
DATASET_DIR=data/slim pnpm run:cases -- --store tigergraph --out cases
```

### Expected Output
Each case JSON now includes:
```json
{
  "case": {
    "summary": "Technical summary for analysts...",
    "customer_explanation": "Simple explanation for customers...",
    "fraud_probability": 0.94,
    "verdict": "fraud"
  }
}
```

## Validation

The customer explanation is checked for:
1. ✅ **Length:** 2-4 sentences
2. ✅ **Numbers:** All must exist in the brief
3. ✅ **Language:** No technical jargon
4. ✅ **Tone:** Respectful, clear, actionable

## Failure Handling

If the LLM can't generate a customer explanation:
- ❌ Does NOT stop the investigation
- ✅ Investigation completes normally
- ✅ All decisions still made by math
- ✅ Answer file still generated
- 📝 `customer_explanation` will be `undefined`
- 📋 Event log shows: "Could not generate customer explanation"

## Token Usage

Adds approximately **150-300 tokens** per case:
- ~100 tokens input (brief)
- ~50-200 tokens output (explanation)

At scale with 1000 cases/day:
- Cost: ~$0.01-0.05/day (with free Ollama models: $0)

## Benefits

1. **Transparency:** Customers understand what's happening
2. **Trust:** Plain language builds confidence
3. **Efficiency:** Less time explaining to customers
4. **Compliance:** Clear communication improves satisfaction
5. **Accessibility:** Non-technical users can understand

## Technical Notes

- **Non-blocking:** Runs after math decisions are made
- **Optional:** Field is optional in schema (backward compatible)
- **Validated:** All output checked against brief
- **Cached:** Uses same response cache as other narrator calls
- **Fast:** ~1-2 seconds with local Ollama

## Future Enhancements

Possible additions:
1. **Multi-language support** (Spanish, French, etc.)
2. **Reading level adjustment** (6th grade, 8th grade, etc.)
3. **SMS/email templates** using customer explanation
4. **Voice-friendly version** for phone calls
5. **Visual diagrams** showing what happened

## Files Changed

```
Backend:
✓ backend/src/llm/narrator.ts (added explainToCustomer method)
✓ backend/src/agent/orchestrator.ts (calls new method)
✓ shared/src/index.ts (added customer_explanation field)

Frontend:
✓ frontend/components/CustomerExplanation.tsx (new component)
✓ frontend/components/Verdict.tsx (integrated component)
```

## No Breaking Changes

- ✅ Existing answer files still valid
- ✅ Tests still pass
- ✅ All APIs backward compatible
- ✅ Optional field (won't break parsers)

---

**Summary:** We added an LLM-powered customer explanation feature that translates technical fraud findings into simple language, without changing any of the mathematical decision-making that makes the system reliable and auditable.
