// ---------------------------------------------------------------------------
// One definition of quote/invoice outcomes, shared by every slide and metric so
// "accepted", "declined" and "voided" mean the same thing everywhere.
// Zuper estimate statuses seen live (2026-09-23): DRAFT, AWAIT_RESPONSE,
// APPROVED, CANCELED, ARCHIVED. Other accounts may use SENT / REJECTED /
// DECLINED / EXPIRED, so matching is by substring.
// ---------------------------------------------------------------------------

export type QuoteOutcome = "accepted" | "declined" | "archived" | "draft" | "open";

export function classifyQuote(q: { status: string; isConverted: boolean; isExpired: boolean }): QuoteOutcome {
  const s = q.status.toLowerCase();
  if (q.isConverted || /approv|accept|won|convert/.test(s)) return "accepted";
  if (/reject|declin|lost/.test(s)) return "declined";
  if (/archiv|cancel|void/.test(s) || q.isExpired || /expir/.test(s)) return "archived";
  if (/draft/.test(s)) return "draft";
  return "open";
}

/** Quotes that reached the customer — the acceptance-rate denominator (drafts were never sent). */
export function isSentQuote(outcome: QuoteOutcome): boolean {
  return outcome !== "draft";
}

export const QUOTE_ACCEPTANCE_DEFINITION =
  "Accepted quotes (status Approved/Accepted, or converted to a job/invoice) ÷ quotes that left draft, for quotes dated in the period.";

export type InvoiceOutcome = "fully_paid" | "partially_paid" | "open" | "void";

export function classifyInvoice(inv: { status: string; amount: number; amountPaid: number; isPaid: boolean }): InvoiceOutcome {
  const s = inv.status.toLowerCase();
  if (/void|cancel|archiv|delet/.test(s)) return "void";
  if (inv.isPaid || (inv.amount > 0 && inv.amountPaid >= inv.amount - 0.005)) return "fully_paid";
  if (inv.amountPaid > 0) return "partially_paid";
  return "open";
}

export const INVOICE_COLLECTION_DEFINITION =
  "Amount paid against invoices dated in the period ÷ their total value, excluding voided/canceled/archived invoices.";
