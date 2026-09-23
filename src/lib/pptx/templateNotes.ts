import type { DateRange } from "@/lib/zuper/modules";
import type { JobMetrics, PaymentMetrics } from "@/lib/analytics";
import type {
  FootprintComparison,
  InvoiceBreakdown,
  JobCategoryShare,
  MonthBucket,
  QuarterBucket,
  QuoteBreakdown,
  RecommendationSignal,
  WorkflowSummary,
} from "@/lib/reports/ebrMetrics";
import type { AccountActivityDates, ExecutionDeepDive, SyncInfo } from "@/lib/reports/moduleMetrics";
import type { BusinessRecommendation } from "@/lib/ai";
import { INVOICE_COLLECTION_DEFINITION, QUOTE_ACCEPTANCE_DEFINITION } from "@/lib/reports/classify";
import { fmtInt, fmtMoneyCompact } from "./generatedSlide";
import type { SlideNotes } from "./slideNotes";

// ---------------------------------------------------------------------------
// Speaker notes for the fixed slides of templates/ebr-template.pptx (slide1–29).
// Every number quoted here is the same computed value the slide renders.
// Call-outs fire on explicit thresholds so they're consistent across accounts;
// the threshold is stated in the call-out so the CSM knows why it appeared.
// ---------------------------------------------------------------------------

export interface TemplateNotesInput {
  customerName: string;
  range: DateRange;
  periodLabel: string;
  jobs: JobMetrics;
  quotes: QuoteBreakdown;
  invoices: InvoiceBreakdown;
  payments: PaymentMetrics;
  topCategories: JobCategoryShare[];
  footprint: FootprintComparison;
  quarters: QuarterBucket[];
  months: MonthBucket[];
  workflowSummary: WorkflowSummary;
  exec: ExecutionDeepDive;
  sync: SyncInfo;
  firsts: AccountActivityDates;
  signals: RecommendationSignal[];
  recommendations: BusinessRecommendation[];
  acceptedQuoteValue13m: number;
  avgInvoicePctChange: number | null;
  quoteValuePctChange: number | null;
}

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const date = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
const money = fmtMoneyCompact;
const compact = (xs: (string | null | false | undefined)[]) => xs.filter(Boolean) as string[];

/** Shared caveat about which sync the figures come from. */
export function syncCaveat(sync: SyncInfo, range: DateRange): string {
  if (!sync.completedAt) return "No successful Zuper sync is recorded for this account — every figure may be empty. Run Sync from Zuper before presenting.";
  const base = `Figures come from the Zuper sync completed ${date(sync.completedAt)}; records created or changed in Zuper after that are not included.`;
  return sync.periodOutsideSync
    ? `${base} The report period (${date(range.start)} – ${date(range.end)}) is not fully covered by that sync — re-sync with this period for complete figures.`
    : base;
}

const ZUPER_FACTS_EDIT = "These are Zuper company facts, not this account's data — confirm they are still current before presenting.";

export function buildTemplateNotes(i: TemplateNotesInput): Record<string, SlideNotes> {
  const { customerName: name, jobs, quotes, invoices, payments, footprint, workflowSummary: wf, exec, sync } = i;
  const syncLine = syncCaveat(sync, i.range);
  const [cat1] = i.topCategories;
  const lastQ = i.quarters[i.quarters.length - 1];
  const quarterRange = `${i.quarters[0]?.label} – ${lastQ?.label}`;
  const execSuccess = exec.available && exec.completed + exec.failed ? exec.completed / (exec.completed + exec.failed) : null;

  const notes: Record<string, SlideNotes> = {};
  const set = (n: number, s: SlideNotes) => (notes[`ppt/slides/slide${n}.xml`] = s);

  // ---- 1–10: cover, Zuper story, team -------------------------------------------------
  set(1, {
    purpose: `Cover slide for ${name}'s review covering ${i.periodLabel}.`,
    talkingPoints: [
      `Open by framing the session: what ${name} set out to achieve with Zuper, what the data shows for ${i.periodLabel}, and what to prioritize next.`,
    ],
    metrics: [{ label: "Report date", value: i.range.end.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), definition: "Month of the report period's end date.", source: "Report settings" }],
    caveats: [syncLine],
  });
  set(2, { purpose: "Section divider: Zuper's journey and focus on the trades.", talkingPoints: ["Keep this section short (2–3 minutes) — the customer's own results are the focus of the meeting."] });
  set(3, {
    purpose: "Zuper's add-on products. Use it to connect add-ons to gaps seen in this account's data later in the deck.",
    callouts: compact([
      payments.total > 0
        ? `Payments: ${pct(payments.onlineShare, 0)} of ${money(payments.totalAmount)} received this period was paid online (payment mode type ONLINE)${payments.onlineShare < 0.2 ? " — low digital collection makes Zuper Pay relevant here." : "."}`
        : "No payments were recorded in Zuper this period, so there's no evidence yet of Zuper Pay or digital collection use.",
      wf.total === 0
        ? "Workflow Builder: no workflows are configured — a clear gap to raise."
        : `Workflow Builder: ${fmtInt(wf.live)} of ${fmtInt(wf.total)} workflows are live.`,
    ]),
    caveats: ["Usage of Zuper Connect, Customer Portal, Report Builder, Fleet and Instant Estimate is not exposed through the account's API — confirm with the customer rather than assuming they use (or don't use) them."],
  });
  set(4, { purpose: "Agenda for the session.", talkingPoints: ["Confirm time allocation and any topics the customer wants to add before starting."] });
  set(5, { purpose: "Zuper's company evolution, 2018–2025.", editBeforePresenting: [ZUPER_FACTS_EDIT] });
  set(6, { purpose: "Zuper's company evolution timeline and recent recognition.", talkingPoints: ["Walk the years left to right. Land on 2025: services focus and expansion."], editBeforePresenting: [ZUPER_FACTS_EDIT] });
  set(7, {
    purpose: "Zuper platform-wide momentum (all customers, not this account).",
    talkingPoints: ["Use these to establish scale and reliability; don't present them as this customer's numbers."],
    editBeforePresenting: [ZUPER_FACTS_EDIT],
  });
  set(8, { purpose: "Zuper's investors.", editBeforePresenting: [ZUPER_FACTS_EDIT] });
  set(9, { purpose: "Zuper's advisors.", editBeforePresenting: [ZUPER_FACTS_EDIT] });
  set(10, { purpose: `The Zuper team supporting ${name}.`, editBeforePresenting: ["Confirm the names and roles shown are the right team for this account (add the CSM/AM by name if they're not shown)."] });

  // ---- 11: partnership journey ---------------------------------------------------------
  set(11, {
    purpose: `${name}'s partnership timeline with Zuper.`,
    callouts: compact([
      i.firsts.firstJob && `First job in Zuper: ${date(i.firsts.firstJob)}.`,
      i.firsts.firstQuote && `First quote: ${date(i.firsts.firstQuote)}.`,
      i.firsts.firstInvoice && `First invoice: ${date(i.firsts.firstInvoice)}.`,
      i.firsts.firstPayment && `First payment recorded: ${date(i.firsts.firstPayment)}.`,
      i.firsts.firstWorkflow && `First workflow built: ${date(i.firsts.firstWorkflow)}.`,
    ]),
    metrics: [{ label: "First-use dates", definition: "Earliest record of each type in the synced data. Sync pulls full history, so these are first recorded use — unless records were imported or deleted.", source: "Zuper Jobs, Quotes, Invoices, Payments, Workflow Builder", evidence: "Observed activity" }],
    editBeforePresenting: [
      "The milestone dates and descriptions on this slide are placeholder copy from another account. Replace them with this customer's real contract, onboarding, training and launch dates (the first-use dates above help anchor go-live).",
    ],
  });
  set(12, { purpose: "Section divider: business KPIs, insights and trends.", talkingPoints: ["Set up the next section: everything that follows is counted directly from the account's Zuper records for the report period."] });

  // ---- 13: business performance overview ---------------------------------------------------
  set(13, {
    purpose: `Headline jobs, quotes and invoices for ${i.periodLabel}.`,
    callouts: compact([
      jobs.total > 0 && `${fmtInt(jobs.completed)} of ${fmtInt(jobs.total)} jobs created this period are completed (${pct(jobs.completionRate)}).${jobs.completionRate < 0.6 ? " Under 60% — check whether open jobs are genuinely in progress or just not closed out in Zuper." : ""}`,
      quotes.sent > 0 &&
        `Quote acceptance is ${pct(quotes.accepted.rate)} (${fmtInt(quotes.accepted.count)} of ${fmtInt(quotes.sent)} sent quotes)${quotes.accepted.rate < 0.3 ? " — below 30%, so quote follow-up is worth discussing." : quotes.accepted.rate >= 0.5 ? " — a strong win rate worth recognizing." : "."}`,
      invoices.billable > 0 &&
        `Collection rate is ${pct(invoices.collectionRate)} of ${money(invoices.totalValue)} invoiced${invoices.collectionRate < 0.8 ? " — under 80%; see the invoice slides for what's still outstanding." : "."}`,
      invoices.agedOver60.count > 0 && `${money(invoices.agedOver60.value)} on ${fmtInt(invoices.agedOver60.count)} invoices is more than 60 days past due.`,
    ]),
    talkingPoints: ["Frame these as the volume Zuper is carrying for the business, then move to what's working and where the gaps are."],
    metrics: [
      { label: "Total Jobs", value: fmtInt(jobs.total), definition: "Jobs created in the report period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Completed", value: fmtInt(jobs.completed), definition: "Of those jobs, the ones whose current status type is Completed or Closed.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Completion rate", value: pct(jobs.completionRate), definition: "Completed ÷ total jobs created in the period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Quotes value", value: money(quotes.totalValue), definition: `Total value of all ${fmtInt(quotes.total)} quotes dated in the period (including ${fmtInt(quotes.drafts)} drafts).`, source: "Zuper Quotes (estimates)", evidence: "Observed activity" },
      { label: "Accepted", value: `${money(quotes.accepted.value)} · ${fmtInt(quotes.accepted.count)}`, definition: "Quotes with status Approved/Accepted, or converted.", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Acceptance rate", value: pct(quotes.accepted.rate), definition: QUOTE_ACCEPTANCE_DEFINITION, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Invoices value", value: `${money(invoices.totalValue)} · ${fmtInt(invoices.billable)}`, definition: `Invoices dated in the period, excluding ${fmtInt(invoices.archived.count)} voided/archived.`, source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Paid", value: `${money(invoices.totalCollected)} · ${fmtInt(invoices.fullyPaid.count)} paid in full`, definition: "Amount paid so far against those invoices; count is invoices paid in full.", source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Collection rate", value: pct(invoices.collectionRate), definition: INVOICE_COLLECTION_DEFINITION, source: "Zuper Invoices", evidence: "Observed activity" },
    ],
    caveats: [
      "Completion counts are for jobs created in the period — jobs created late in the period naturally have lower completion.",
      "Invoiced value and collections are billing activity, not revenue or profit.",
      syncLine,
    ],
  });

  // ---- 14: job performance -----------------------------------------------------------------
  set(14, {
    purpose: "Job volume by category and the users doing the work.",
    callouts: compact([
      cat1 && `${cat1.name} is the largest category: ${fmtInt(cat1.count)} jobs (${pct(cat1.pct)} of jobs created).`,
      cat1 && cat1.pct > 0.6 && `One category carries over 60% of the work — ask whether that's the business's core service or a gap in how other work is categorized in Zuper.`,
      cat1?.name === "Unspecified" && "Many jobs have no job category — categorizing them unlocks better reporting.",
      `${fmtInt(footprint.activeUserCount)} active users on the account.`,
    ]),
    metrics: [
      { label: "Jobs Completed", value: fmtInt(jobs.completed), definition: "Jobs created in the period that are now Completed or Closed.", source: "Zuper Jobs", evidence: "Observed activity" },
      ...i.topCategories.map((c, idx) => ({
        label: `Category ${idx + 1}: ${c.name}`,
        value: `${fmtInt(c.count)} (${pct(c.pct)})`,
        definition: "Jobs created in the period with this job category ÷ all jobs created in the period.",
        source: "Zuper Jobs (job_category)",
        evidence: "Observed activity" as const,
      })),
      { label: "Active Users", value: fmtInt(footprint.activeUserCount), definition: "Users marked active across the account's teams at sync time.", source: "Zuper Teams", evidence: "Current state" },
    ],
    caveats: ["Active users is not the contracted seat count — that's a billing figure the API doesn't expose.", syncLine],
  });

  // ---- 15: daily operations footprint ---------------------------------------------------------
  const currentYear = footprint.currentLabel.replace(/ YTD$/, "");
  set(15, {
    purpose: `How much of ${name}'s operation now runs through Zuper: ${footprint.currentLabel} versus ${footprint.priorLabel.toLowerCase()}.`,
    callouts: compact([
      footprint.priorJobs === 0 && footprint.priorQuotes === 0 && footprint.priorInvoices === 0 && `${name} has no activity in Zuper before ${currentYear} — present this as their first year on the platform, not as growth.`,
      `Jobs: ${fmtInt(footprint.priorJobs)} in ${footprint.priorLabel.toLowerCase()} → ${fmtInt(footprint.currentJobs)} so far in ${currentYear}.`,
      `Estimates: ${fmtInt(footprint.priorQuotes)} → ${fmtInt(footprint.currentQuotes)}. Invoices: ${fmtInt(footprint.priorInvoices)} → ${fmtInt(footprint.currentInvoices)}.`,
      footprint.priorJobs > 0 && footprint.currentJobs > footprint.priorJobs && `Year-to-date jobs already exceed the whole of last year.`,
    ]),
    talkingPoints: [
      "Use this slide to show operational importance, not merely product adoption.",
      `The periods are unequal (${footprint.currentLabel} vs a full prior year), so don't describe the differences as year-over-year growth percentages.`,
    ],
    metrics: [
      { label: "Estimate value", value: money(footprint.quoteValue), definition: `Total value of quotes dated in the report period (${i.periodLabel}).`, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Invoice value", value: money(footprint.invoiceValue), definition: "Total value of non-voided invoices dated in the report period.", source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Properties", value: fmtInt(footprint.propertiesCount), definition: `Service locations on the account (all-time). The account also has ${fmtInt(footprint.endCustomerCount)} customers.`, source: "Zuper Properties", evidence: "Current state" },
      { label: "Total user identities", value: fmtInt(footprint.totalUserIdentities), definition: "Distinct users across all teams, active or not.", source: "Zuper Teams", evidence: "Current state" },
      { label: "Jobs / Estimates / Invoices", definition: `Records created in ${footprint.priorLabel.toLowerCase()} vs from Jan 1 ${currentYear} to the report end date.`, source: "Zuper Jobs, Quotes, Invoices", evidence: "Observed change" },
    ],
    caveats: [
      footprint.propertiesCount === 0 ? "This account has no properties in Zuper, so Properties shows 0 — consider hiding that tile." : null,
      "A higher count shows more activity recorded in Zuper; it doesn't by itself prove Zuper caused business growth.",
      syncLine,
    ].filter(Boolean) as string[],
  });

  // ---- 16: revenue & quote performance ---------------------------------------------------------
  set(16, {
    purpose: "Where every quote and invoice from the period ended up.",
    callouts: compact([
      quotes.open.value > 0 && `${money(quotes.open.value)} across ${fmtInt(quotes.open.count)} quotes is still open — the pipeline to follow up on.`,
      quotes.declined.count > 0 && `${fmtInt(quotes.declined.count)} quotes (${money(quotes.declined.value)}) were declined — ask whether price, timing or scope drove it.`,
      invoices.partiallyPaid.count > 0 && `${fmtInt(invoices.partiallyPaid.count)} invoices are partially paid with ${money(invoices.partiallyPaid.outstanding)} still to collect.`,
      invoices.agedOver60.count > 0 ? `${money(invoices.agedOver60.value)} is more than 60 days past due — a collections conversation.` : "No invoices from this period are more than 60 days past due.",
    ]),
    metrics: [
      { label: "Accepted / Declined rate", value: `${pct(quotes.accepted.rate)} / ${pct(quotes.declined.rate)}`, definition: `Share of the ${fmtInt(quotes.sent)} quotes that left draft.`, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Open / Pending", value: `${fmtInt(quotes.open.count)} · ${money(quotes.open.value)}`, definition: `Quotes still awaiting a response, including ${fmtInt(quotes.drafts)} drafts. Percentage is of all quotes.`, source: "Zuper Quotes", evidence: "Current state" },
      { label: "Archived / Canceled", value: `${fmtInt(quotes.archived.count)} · ${money(quotes.archived.value)}`, definition: "Quotes canceled, archived or expired. Percentage is of all quotes.", source: "Zuper Quotes", evidence: "Current state" },
      { label: "Fully / Partially paid", value: `${fmtInt(invoices.fullyPaid.count)} / ${fmtInt(invoices.partiallyPaid.count)}`, definition: `Of ${fmtInt(invoices.billable)} non-voided invoices dated in the period.`, source: "Zuper Invoices", evidence: "Current state" },
      { label: "Open / Unpaid", value: `${fmtInt(invoices.open.count)} · ${money(invoices.open.value)}`, definition: "Non-voided invoices with nothing paid yet.", source: "Zuper Invoices", evidence: "Current state" },
      { label: "Over 60 days past due", value: money(invoices.agedOver60.value), definition: "Unpaid balance (open + partially paid) on invoices whose due date is more than 60 days before today.", source: "Zuper Invoices", evidence: "Current state" },
    ],
    caveats: ["Open quote value is potential work, not revenue already earned.", "Statuses are as of the sync date — invoices keep getting paid after it.", syncLine],
  });

  // ---- 17: quote quarterly -------------------------------------------------------------------
  const quarterRates = i.quarters.filter((q) => q.quotesSent > 0);
  set(17, {
    purpose: `Quote acceptance and value by calendar quarter (${quarterRange}).`,
    callouts: compact([
      ...quarterRates.map((q) => `${q.label}: ${q.acceptanceRatePct.toFixed(1)}% acceptance of ${fmtInt(q.quotesSent)} sent quotes; ${money(q.quotesAcceptedValue)} accepted vs ${money(q.quotesDeclinedValue)} declined.`),
      !quarterRates.length && "No quotes were sent in these quarters.",
    ]),
    metrics: [
      { label: "Quarterly acceptance rate", definition: `${QUOTE_ACCEPTANCE_DEFINITION} Calculated per quarter by quote date.`, source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Accepted vs Declined ($M)", definition: "Sum of quote value by outcome, per quarter, in millions.", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Totals row", value: `${money(quotes.totalValue)} · ${fmtInt(quotes.total)} quotes`, definition: `Quotes dated in the report period (${i.periodLabel}) — not just the four quarters charted.`, source: "Zuper Quotes", evidence: "Observed activity" },
    ],
    caveats: ["Recent quarters' quotes are still being decided, so their acceptance rate usually rises over time — don't compare an in-progress quarter directly with a completed one.", syncLine],
  });

  // ---- 18: invoice quarterly -------------------------------------------------------------------
  set(18, {
    purpose: `Invoiced vs collected value by calendar quarter (${quarterRange}).`,
    callouts: i.quarters
      .filter((q) => q.invoicesInvoicedValue > 0)
      .map((q) => `${q.label}: ${money(q.invoicesInvoicedValue)} invoiced, ${money(q.invoicesCollectedValue)} collected (${q.collectionRatePct.toFixed(1)}%).`),
    metrics: [
      { label: "Quarterly collection rate", definition: `${INVOICE_COLLECTION_DEFINITION} Calculated per quarter by invoice date.`, source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Totals row", value: `${fmtInt(invoices.billable)} invoices · ${money(invoices.totalValue)} · ${pct(invoices.collectionRate)}`, definition: `Invoices dated in the report period (${i.periodLabel}), excluding voided.`, source: "Zuper Invoices", evidence: "Observed activity" },
    ],
    caveats: ["The latest quarter's collection rate is always lower because its invoices haven't come due yet.", "Collections are cash timing, not additional revenue.", syncLine],
  });

  // ---- 19: 13-month trend -----------------------------------------------------------------------
  set(19, {
    purpose: "Monthly average invoice value and unaccepted quote value over the trailing 13 months.",
    callouts: compact([
      i.avgInvoicePctChange != null && `Average invoice value ${i.avgInvoicePctChange >= 0 ? "rose" : "fell"} ${Math.abs(i.avgInvoicePctChange).toFixed(0)}% between the first and last month with at least 5 invoices.`,
      ...i.months.filter((m) => m.invoiceCount > 0 && m.invoiceCount < 5).slice(0, 3).map((m) => `${m.label} had only ${m.invoiceCount} invoice${m.invoiceCount === 1 ? "" : "s"}, so its average isn't comparable.`),
      i.quoteValuePctChange != null && `Unaccepted quote value ${i.quoteValuePctChange >= 0 ? "rose" : "fell"} ${Math.abs(i.quoteValuePctChange).toFixed(0)}% from the first to the last month.`,
      `Accepted quote value across the 13 months: ${money(i.acceptedQuoteValue13m)}.`,
    ]),
    talkingPoints: ["A change in average invoice value can reflect job mix (bigger vs smaller jobs), pricing, or how work is split across invoices — ask the customer which applies before drawing conclusions."],
    metrics: [
      { label: "Monthly average invoice value", definition: "Mean value of non-voided invoices dated in each month.", source: "Zuper Invoices", evidence: "Observed activity" },
      { label: "Monthly unaccepted quote value", definition: "Value of quotes dated in each month that are open, draft or declined (not accepted, not canceled).", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Change %", definition: "Last vs first month of the window. For average invoice value, first/last month with at least 5 invoices, so one or two invoices can't swing it.", source: "Computed", evidence: "Observed change" },
    ],
    caveats: ["Single months with few invoices swing the average a lot — check the invoice count per month before calling out a trend.", "The most recent months' quotes are still open, which inflates unaccepted value at the end of the window.", syncLine],
  });
  set(20, { purpose: "Section divider: value, adoption and scaling.", talkingPoints: ["Transition from business results to how the platform itself is being used."] });

  // ---- 21: platform performance ------------------------------------------------------------------
  set(21, {
    purpose: "Workflow automation performance and overall usage scale.",
    callouts: compact([
      `${fmtInt(wf.live)} of ${fmtInt(wf.total)} workflows are live (active and published).`,
      exec.available && `${fmtInt(exec.total)} workflow runs ${date(exec.countedFrom)} – ${date(exec.countedTo)}; success rate ${execSuccess != null ? pct(execSuccess) : "—"}.`,
      exec.available && exec.failed > 0 && `${fmtInt(exec.failed)} runs failed${exec.topErrors[0] ? `, most often "${exec.topErrors[0].message}"` : ""}.`,
      wf.needsAttention > 0 && `${fmtInt(wf.needsAttention)} workflows are flagged by Workflow Builder as needing attention.`,
    ]),
    metrics: [
      { label: "Live Workflows", value: `${fmtInt(wf.live)} of ${fmtInt(wf.total)}`, definition: "Workflows that are both active and published (drafts never run).", source: "Zuper Workflow Builder", evidence: "Configuration" },
      { label: "Runs", value: exec.available ? fmtInt(exec.total) : "Not synced", definition: "Completed + failed + skipped executions in the window shown. Zuper keeps about two months of run history, so the window can be shorter than the report period.", source: "Workflow Builder execution history", evidence: exec.available ? "Observed activity" : "Insufficient data" },
      { label: "Success rate", value: execSuccess != null ? pct(execSuccess) : "—", definition: "Completed ÷ (completed + failed) runs; skipped runs (trigger conditions not met) are excluded.", source: "Workflow Builder execution history", evidence: exec.available ? "Observed activity" : "Insufficient data" },
      { label: "Jobs Created / Invoice value / Active users", value: `${fmtInt(jobs.total)} / ${money(invoices.totalValue)} / ${fmtInt(footprint.activeUserCount)}`, definition: "Same figures as the Business Performance slide.", source: "Zuper Jobs, Invoices, Teams", evidence: "Observed activity" },
    ],
    caveats: ["API calls per month, P95 response time and attachment storage aren't exposed through the account's API, so they show \"Not in API\"."],
    editBeforePresenting: ["Contracted users is a billing figure — fill it in from the contract, or delete that line."],
  });
  set(22, { purpose: "Section divider: Zuper add-ons and AI features.", talkingPoints: ["Position what's next in terms of the gaps surfaced earlier in the deck."] });

  // ---- 23–25: AI agents ----------------------------------------------------------------------------
  set(23, {
    purpose: "Zuper Field Agent (AI companion for technicians).",
    callouts: [`${fmtInt(jobs.total)} jobs were created this period — the documentation load Field Agent would take on.`],
    caveats: ["Product claims on this slide come from Zuper product marketing, not this account's data."],
  });
  set(24, {
    purpose: "Zuper CSR Agent (AI receptionist).",
    caveats: ["The call-surge figures on this slide are from a Zuper case study, not this account. Call volumes aren't in the synced data — ask the customer about missed or after-hours calls."],
  });
  set(25, {
    purpose: "Zuper AR Agent (AI collections).",
    callouts: compact([
      invoices.agedOver60.count > 0
        ? `Directly relevant: ${money(invoices.agedOver60.value)} on ${fmtInt(invoices.agedOver60.count)} invoices from this period is more than 60 days past due.`
        : "No invoices from this period are more than 60 days past due, so position AR Agent as preventive rather than urgent.",
      invoices.partiallyPaid.outstanding > 0 && `${money(invoices.partiallyPaid.outstanding)} is also outstanding on partially paid invoices.`,
    ]),
    caveats: ["The worklist amounts on the slide are illustrative, not this account's invoices."],
  });

  // ---- 26–29: built together, working session, priorities, scaling ------------------------------------
  set(26, {
    purpose: `What Zuper and ${name} have built together.`,
    callouts: compact([
      wf.live > 0 && `Live automations to cite: ${wf.workflows.filter((w) => w.isLive).slice(0, 5).map((w) => w.name).join("; ")}.`,
      quotes.total > 0 && `Quoting in Zuper: ${fmtInt(quotes.total)} quotes this period.`,
      payments.total > 0 && `Payments recorded in Zuper: ${fmtInt(payments.total)} (${money(payments.totalAmount)}).`,
    ]),
    editBeforePresenting: [
      "Every item on this slide is placeholder copy from another account (V2→V3 upgrade, CPQ onboarding, 10DLC, etc.). Replace it with what was actually delivered for this customer, or delete the slide.",
    ],
  });
  set(27, {
    purpose: "Leadership working session: pick the two outcomes to prioritize for the next six months.",
    talkingPoints: compact([
      "Keep the discussion positive and forward-looking. Ask leaders to pick the two outcomes that create the most value in the next six months.",
      quotes.sent > 0 && `Convert more pipeline — data point: ${pct(quotes.accepted.rate)} acceptance, ${money(quotes.open.value)} still open.`,
      payments.total > 0 && `Customer experience — data point: ${pct(payments.onlineShare, 0)} of payments collected online.`,
      `Operational efficiency — data point: ${fmtInt(wf.live)} live workflows${exec.available ? `, ${fmtInt(exec.failed)} failed runs` : ""}.`,
    ]),
    caveats: ["Record the two outcomes chosen — they become the goals the next review measures against."],
  });
  set(28, {
    purpose: "Recommended priorities for the next six months.",
    callouts: i.recommendations.map((r, idx) => `${idx + 1}. ${r.title} — ${r.description}`),
    metrics: i.signals.map((s) => ({ label: s.title, definition: s.detail, source: "Computed from this account's Zuper data", evidence: "Observed activity" as const })),
    caveats: compact([
      i.signals.length < 4 && `Only ${i.signals.length} of the 4 priorities are backed by this account's data; the rest are general best-practice suggestions — replace them if you have something more specific.`,
      "Titles and wording may be AI-polished, but every number comes from the evidence listed above.",
    ]),
  });
  set(29, {
    purpose: `Scaling together: Zuper's readiness to support ${name}'s growth.`,
    editBeforePresenting: [
      "The timeline figures (\"X users\", \"Y Volume\", \"A data point\", \"B data point\", countries, franchisees, acquisitions) are placeholders. Fill them in with this customer's growth story or delete the timeline.",
      "Check the headline (\"1 State → 20 States\") matches this customer's footprint.",
    ],
  });

  return notes;
}
