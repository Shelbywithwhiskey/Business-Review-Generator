// The business review types. The full name is the reference everywhere it appears — the report page,
// the deck title, the Account Brief, the file name — and the type sets the default period.
// Client-safe (no server imports): the customer page uses it for the picker.

export type ReportTypeKey = "MBR" | "QBR" | "HBR" | "YBR";

export const REPORT_TYPES: Record<ReportTypeKey, { name: string; months: number; periodWord: string }> = {
  MBR: { name: "Monthly Business Review", months: 1, periodWord: "month" },
  QBR: { name: "Quarterly Business Review", months: 3, periodWord: "quarter" },
  HBR: { name: "Half-Yearly Business Review", months: 6, periodWord: "half-year" },
  YBR: { name: "Yearly Business Review", months: 12, periodWord: "year" },
};

/** Picker order: shortest period first. */
export const REPORT_TYPE_ORDER: ReportTypeKey[] = ["MBR", "QBR", "HBR", "YBR"];

export function reportTypeName(type: string): string {
  return REPORT_TYPES[type as ReportTypeKey]?.name ?? "Business Review";
}

/** "quarter", "month", … for a review's full name (falls back to "period"). */
export function periodWordFor(reviewName: string): string {
  return Object.values(REPORT_TYPES).find((t) => t.name === reviewName)?.periodWord ?? "period";
}

/** The period a review of this type covers by default: the last N months up to today (YYYY-MM-DD). */
export function defaultPeriod(type: ReportTypeKey, today = new Date()): { start: string; end: string } {
  const end = new Date(today);
  const start = new Date(today);
  start.setMonth(start.getMonth() - REPORT_TYPES[type].months);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
