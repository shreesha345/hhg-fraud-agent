/**
 * Log-odds constants used by the signatures and the judge. These are v0 DEFAULTS chosen by reasoning about the
 * policy and the measurements in py/notebooks/01_*. They are not tuned to the exam.
 *
 * `loadBaselineJson()` can read the table written by py/notebooks/02_* (calibration/baseline_v0.json). Those
 * numbers are estimated inside the score>=0.8 zone only, so they are reported and available but NOT applied by
 * default (see CLAUDE.md, section 8). Apply them deliberately after the full backtest exists.
 */
import { existsSync, readFileSync } from "node:fs";

export const LR = {
  // prosecution (positive = toward fraud)
  test_then_spend: 3.0,
  off_profile_burst: 1.6,
  new_device: 1.2,
  /**
   * At bank score >= 0.8 a New device is evidence of a new phone, not of fraud: in closed history 86% of cleared alerts
   * in that zone show a New device against 21% of fraud. Equals baseline_v0.json new_device.log_lr_present
   * (measured, shrunk by 0.5); a test keeps the two in sync. See py/notebooks/02_*, section 6b.
   */
  new_device_in_zone: -0.7,
  zone_score: 0.8,
  threshold_hugging: 3.0,
  shared_rare_fingerprint: 3.0,
  out_of_region_home_continues: 1.5,
  customer_report: 1.6,
  // defence (negative = toward innocence)
  trip_continuity: -2.6,
  device_succession: -2.6,
  recurring_cadence: -2.6,
  baseline_consistent: -1.3,
  // bank score curve (non-monotonic on purpose)
  bank_low: -0.4,
  bank_mid: 0.2,
  // memory: per net similar closed case, capped in the signature
  memory_per_case: 0.5,
  // customer reply once asked
  reply_denies: 3.5,
  reply_confirms: -3.5,
  // judge
  prior: 0.4,
  damping: 0.85,
  hi: 0.85,
  lo: 0.15,
  class_min: 0.5,
};

export interface BaselineSignal { p_given_fraud: number; p_given_cleared: number; log_lr_present: number; log_lr_absent: number }
export interface BaselineFile { version: string; zone: string; signals: Record<string, BaselineSignal> }

export function loadBaselineJson(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
}
