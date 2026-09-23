import type JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import type { CoverageRow, JobServiceDelivery, ModuleAnalysis, PortalAndPay } from "@/lib/reports/catalogMetrics";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, fmtMoneyCompact, insertGeneratedSlide, run, truncate } from "./generatedSlide";
import type { MetricDefinition } from "./slideNotes";

// ---------------------------------------------------------------------------
// Slides for everything beyond the core modules: jobs service delivery & time
// on site, Customer Portal & Zuper Pay, Zuper Connect & CSR Agent, one slide
// per catalog module with data, and the data coverage slides. Same visual
// system as moduleSlides.ts; numbers come straight from catalogMetrics.
// ---------------------------------------------------------------------------

const SERIES = ["FD5000", "2A78D6", "1BAF7A", "4A3AA7"];
const GOOD = "0CA30C";
const CRITICAL = "D03B3B";
const KPI_Y = 1300000;
const BODY_Y = 2260000;
const BODY_H = 3520000;
const GAP = 150000;
const HALF_W = (CONTENT_W - GAP) / 2;
const left = { x: CONTENT_X, y: BODY_Y, cx: HALF_W, cy: BODY_H };
const right = { x: CONTENT_X + HALF_W + GAP, y: BODY_Y, cx: HALF_W, cy: BODY_H };

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
const fmtDate = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const period = (r: DateRange) => `${fmtDate(r.start)} – ${fmtDate(r.end)}`;
const compact = (xs: (string | number | null | false | undefined)[]) => xs.filter((x): x is string => typeof x === "string" && x.length > 0);
/** Joins clauses into one sentence, or returns `fallback` when there are none. */
const sentence = (xs: (string | number | null | false | undefined)[], fallback: string) => {
  const parts = compact(xs);
  return parts.length ? `${parts.join("; ")}.` : fallback;
};

interface Ctx {
  customerName: string;
  range: DateRange;
  syncLine: string;
}

function textCard(w: ShapeWriter, box: { x: number; y: number; cx: number; cy: number }, title: string, lines: string[]) {
  const inner = w.card(box.x, box.y, box.cx, box.cy, title);
  lines.slice(0, 7).forEach((l, i) => w.text(inner.x + 60000, inner.y + 60000 + i * 420000, inner.cx - 120000, 380000, run(truncate(l, 95), { sz: 1050, color: COLORS.ink })));
}

// ---- Jobs: service delivery ---------------------------------------------------------------------

export function jobServiceSlide(ctx: Ctx, s: JobServiceDelivery): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Jobs — Service Delivery", `Jobs created ${period(ctx.range)}  ·  on-time, billing follow-through and job mix`);
  const ot = s.onTime;
  const onTimeRate = ot ? ot.onTime / ot.eligible : null;
  const invRate = s.invoicing && s.invoicing.completed ? s.invoicing.invoiced / s.invoicing.completed : null;
  w.kpis(KPI_Y, [
    { value: onTimeRate == null ? "—" : pct(onTimeRate), label: ot ? `On-time completion (${fmtInt(ot.eligible)} due)` : "On-time (no job deadlines)", alert: onTimeRate != null && onTimeRate < 0.7 },
    { value: ot ? fmtInt(ot.overdueOpen) : "—", label: "Overdue & still open", alert: !!ot && ot.overdueOpen > 0 },
    { value: invRate == null ? "—" : pct(invRate), label: s.invoicing ? "Completed jobs with an invoice" : "Invoice link not on jobs", alert: invRate != null && invRate < 0.8 },
    { value: s.unscheduledBacklog == null ? "—" : fmtInt(s.unscheduledBacklog), label: "Unscheduled backlog (live)" },
    { value: s.rating ? s.rating.average.toFixed(1) : "—", label: s.rating ? `Avg customer rating (${fmtInt(s.rating.rated)})` : "No customer ratings" },
  ]);

  const a = w.card(left.x, left.y, left.cx, left.cy, "ON-TIME VS LATE, BY DEADLINE MONTH");
  if (s.onTimeMonthly.some((m) => m.onTime || m.late)) {
    w.chart(a.x, a.y, a.cx, a.cy, {
      kind: "stackedBar",
      categories: s.onTimeMonthly.map((m) => m.label),
      series: [
        { name: "On time", values: s.onTimeMonthly.map((m) => m.onTime), color: GOOD },
        { name: "Late or overdue", values: s.onTimeMonthly.map((m) => m.late), color: CRITICAL },
      ],
      showValues: false,
    });
  } else
    w.empty(
      a,
      s.extraSynced || !s.jobsInPeriod
        ? "Jobs don't carry a scheduled end / due date, so on-time can't be measured"
        : "Re-sync from Zuper to include on-time and billing detail for jobs"
    );

  const b = w.card(right.x, right.y, right.cx, right.cy, s.jobTypes ? `JOBS BY ${s.jobTypes.label.toUpperCase()}` : "JOBS BY PRIORITY");
  const dim = s.jobTypes?.values ?? s.priorities;
  if (dim.length) {
    w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: dim.slice(0, 8).map((d) => truncate(d.name.replace(/_/g, " "), 26)), series: [{ name: "Jobs", values: dim.slice(0, 8).map((d) => d.count), color: SERIES[0] }] });
  } else w.empty(b, "No job type or priority recorded");

  w.insight(
    sentence(
      [
        onTimeRate != null && `${pct(onTimeRate)} of ${fmtInt(ot!.eligible)} jobs due this period were completed by their deadline day`,
        ot && ot.overdueOpen > 0 && `${fmtInt(ot.overdueOpen)} are past due and still open`,
        invRate != null && `${pct(invRate)} of completed jobs have an invoice attached`,
      ],
      "Job deadlines and invoice links aren't recorded on this account's jobs."
    )
  );
  w.footer(`Source: Zuper Jobs (${s.deadlineField ?? "deadline"}, invoice link, priority) & unscheduled jobs · jobs created in the period`);

  const metrics: MetricDefinition[] = [
    {
      label: "On-time completion",
      value: onTimeRate == null ? "—" : pct(onTimeRate, 1),
      definition: `Not-cancelled jobs whose ${s.deadlineField ?? "deadline"} falls in the period: completed on or before the deadline day ÷ (those completed + those still open after their deadline). Jobs not yet due are excluded. Uses the job's current deadline — rescheduled jobs are measured against the new date.`,
      source: "Zuper Jobs",
      evidence: ot ? "Observed activity" : "Insufficient data",
    },
    { label: "Overdue & still open", value: ot ? fmtInt(ot.overdueOpen) : "—", definition: "Jobs due in the period, past their deadline day, not completed or cancelled.", source: "Zuper Jobs", evidence: "Current state" },
    {
      label: "Completed jobs with an invoice",
      value: invRate == null ? "—" : pct(invRate, 1),
      definition: s.invoicing ? `Completed jobs created in the period whose ${s.invoicing.field} is set ÷ all completed jobs created in the period. Proxy for billing follow-through (SPEC timely billing) — deposits or invoicing outside Zuper don't show.` : "The job list doesn't include an invoice link for this account.",
      source: "Zuper Jobs",
      evidence: s.invoicing ? "Observed activity" : "Insufficient data",
    },
    { label: "Unscheduled backlog", value: s.unscheduledBacklog == null ? "—" : fmtInt(s.unscheduledBacklog), definition: "Zuper's live count of unscheduled jobs (all dates) at sync time.", source: "Zuper /jobs/unscheduled", evidence: "Current state" },
    { label: "Avg customer rating", value: s.rating ? s.rating.average.toFixed(2) : "—", definition: s.rating ? `Mean of ${s.rating.field} (1–5) across ${fmtInt(s.rating.rated)} rated jobs.` : "No rating field with values on these jobs.", source: "Zuper Jobs", evidence: s.rating ? "Observed activity" : "Insufficient data" },
  ];
  w.notes = {
    purpose: "Whether jobs are delivered on time and billed — the core promise of the service business.",
    callouts: compact([
      onTimeRate != null && `${pct(onTimeRate)} on-time completion across ${fmtInt(ot!.eligible)} jobs due in the period${onTimeRate < 0.7 ? " — below 70%; ask what's driving late completion (capacity, parts, rescheduling)." : "."}`,
      ot && ot.overdueOpen > 0 && `${fmtInt(ot.overdueOpen)} jobs are overdue and still open — confirm whether they're really outstanding or just not closed out in Zuper.`,
      invRate != null && invRate < 0.8 && `Only ${pct(invRate)} of completed jobs have an invoice attached — either billing happens elsewhere, or completed work isn't being billed promptly. Worth confirming.`,
      s.rating && `Average customer rating ${s.rating.average.toFixed(1)} across ${fmtInt(s.rating.rated)} rated jobs.`,
      s.multiTechShare != null && s.multiTechShare > 0.2 && `${pct(s.multiTechShare)} of jobs have more than one person assigned.`,
      s.unscheduledBacklog != null && s.unscheduledBacklog > 0 && `${fmtInt(s.unscheduledBacklog)} jobs are waiting to be scheduled right now.`,
    ]),
    talkingPoints: ["On-time and billed-on-completion are the two numbers most customers care about — agree which one to improve and set a target for the next review."],
    metrics,
    caveats: compact([
      !s.extraSynced && s.jobsInPeriod > 0 && "This account hasn't been synced since the full job detail was added — run Sync from Zuper again, then re-download the deck.",
      "Deadlines are the job's current schedule; if jobs are rescheduled in Zuper the original promise date isn't kept, which can flatter on-time rate.",
      ctx.syncLine,
    ]),
  };
  return w;
}

// ---- Jobs: time on site ---------------------------------------------------------------------

export function timeOnSiteSlide(ctx: Ctx, s: JobServiceDelivery): ShapeWriter | null {
  const t = s.timeOnSite;
  if (!t) return null;
  const w = new ShapeWriter();
  w.header("Jobs — Time on Site", `Job time logs clocked in ${period(ctx.range)}`);
  w.kpis(KPI_Y, [
    { value: `${fmtInt(t.hours)} h`, label: "Hours logged on jobs" },
    { value: fmtInt(t.jobsWithTime), label: "Jobs with time logged" },
    { value: `${t.avgHoursPerJob.toFixed(1)} h`, label: "Average hours per job" },
    { value: s.jobsInPeriod ? pct(t.jobsWithTime / s.jobsInPeriod) : "—", label: "Jobs with time vs jobs created", alert: s.jobsInPeriod > 0 && t.jobsWithTime / s.jobsInPeriod < 0.3 },
  ]);
  const a = w.card(left.x, left.y, left.cx, left.cy, "AVERAGE HOURS ON SITE BY JOB CATEGORY");
  if (t.byCategory.length) w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: t.byCategory.map((c) => truncate(c.name, 26)), series: [{ name: "Avg hours per job", values: t.byCategory.map((c) => Math.round(c.avgHours * 10) / 10), color: SERIES[1] }], numberFormat: "#,##0.0" });
  else w.empty(a, "Not enough logged jobs per category");
  const b = w.card(right.x, right.y, right.cx, right.cy, "HOURS LOGGED BY PERSON (TOP 10)");
  if (t.byUser.length) w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: t.byUser.map((u) => truncate(u.name, 24)), series: [{ name: "Hours", values: t.byUser.map((u) => Math.round(u.hours)), color: SERIES[0] }] });
  else w.empty(b, "No time logs with a user");
  const top = t.byCategory[0];
  w.insight(`${fmtInt(t.hours)} hours were logged across ${fmtInt(t.jobsWithTime)} jobs (${t.avgHoursPerJob.toFixed(1)} h per job)` + (top ? `; ${top.name} jobs average ${top.avgHours.toFixed(1)} h on site.` : "."));
  w.footer("Source: Zuper job time logs (clock in → clock out per job) · job category from Zuper Jobs");
  w.notes = {
    purpose: "How long the field team spends on jobs — the basis for capacity, pricing and labor-cost conversations.",
    callouts: compact([
      top && `${top.name} jobs take ${top.avgHours.toFixed(1)} hours on site on average (${fmtInt(top.jobs)} jobs).`,
      s.jobsInPeriod > 0 && t.jobsWithTime / s.jobsInPeriod < 0.3 && `Only ${pct(t.jobsWithTime / s.jobsInPeriod)} of jobs have time logged — hours here understate real field time; consistent clock-in on jobs would make labor reporting reliable.`,
      t.byUser[0] && `${t.byUser[0].name} logged the most time (${fmtInt(t.byUser[0].hours)} h).`,
    ]),
    metrics: [
      { label: "Hours logged on jobs", value: `${fmtInt(t.hours)} h`, definition: "Sum of (clock_out_time − clock_in_time) for job time logs clocked in during the period.", source: "Zuper /jobs/timelog_summary", evidence: "Observed activity" },
      { label: "Average hours per job", value: `${t.avgHoursPerJob.toFixed(2)} h`, definition: "Hours logged ÷ distinct jobs with at least one time log.", source: "Zuper job time logs", evidence: "Observed activity" },
      { label: "By category", definition: "Average logged hours per job for jobs created in the period, by job category (categories with fewer than 3 jobs hidden).", source: "Zuper job time logs + Jobs", evidence: "Observed activity" },
    ],
    caveats: ["Time logs only cover jobs where technicians clock in; missing logs are a coverage gap, not zero effort.", "This is time on the job, not travel time or productivity in dollars.", ctx.syncLine],
  };
  return w;
}

// ---- Customer Portal & Zuper Pay -------------------------------------------------------------------

export function portalPaySlide(ctx: Ctx, p: PortalAndPay): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Customer Portal & Zuper Pay", `Payments received ${period(ctx.range)}  ·  portal access is current`);
  const onlineShare = p.online.total ? p.online.amount / p.online.total : 0;
  const notYet = "Not synced yet — re-sync";
  w.kpis(KPI_Y, [
    { value: pct(onlineShare), label: `Paid online (${fmtMoneyCompact(p.online.amount)})`, alert: p.online.total > 0 && onlineShare < 0.2 },
    { value: p.portalPayments ? fmtMoneyCompact(p.portalPayments.amount) : "—", label: p.portalPayments ? `Paid via Customer Portal (${fmtInt(p.portalPayments.count)})` : p.catalogSynced ? "Payment source not recorded" : notYet },
    { value: p.paymentRequests ? fmtInt(p.paymentRequests.inPeriod) : "—", label: p.paymentRequests ? "Payment requests sent this period" : p.catalogSynced ? "No payment requests" : notYet },
    { value: p.portalOrgs ? `${fmtInt(p.portalOrgs.enabled)} / ${fmtInt(p.portalOrgs.total)}` : "—", label: p.portalOrgs ? "Organizations with portal access" : p.catalogSynced ? "No organizations" : notYet },
    { value: p.portalRequests == null ? "—" : fmtInt(p.portalRequests), label: "Service requests from the portal" },
  ]);
  const a = w.card(left.x, left.y, left.cx, left.cy, "PAYMENTS BY SOURCE");
  if (p.paymentSources.length) w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: p.paymentSources.map((s) => truncate(s.name.replace(/_/g, " "), 24)), series: [{ name: "Amount", values: p.paymentSources.map((s) => Math.round(s.amount)), color: SERIES[0] }], numberFormat: "$#,##0" });
  else w.empty(a, "Payments don't record where they were made");
  const b = w.card(right.x, right.y, right.cx, right.cy, "PAYMENT REQUESTS BY STATUS");
  if (p.paymentRequests?.statuses.length) w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: p.paymentRequests.statuses.map((s) => truncate(s.name.replace(/_/g, " "), 24)), series: [{ name: "Requests", values: p.paymentRequests.statuses.map((s) => s.count), color: SERIES[1] }] });
  else w.empty(b, p.paymentRequests ? "Payment requests have no status recorded" : "No Zuper Pay payment requests on the account");
  w.insight(
    sentence(
      [
        p.online.total > 0 && `${pct(onlineShare)} of ${fmtMoneyCompact(p.online.total)} received was paid online`,
        p.portalPayments && p.portalPayments.count > 0 && `${fmtMoneyCompact(p.portalPayments.amount)} came through the Customer Portal`,
        p.portalOrgs && `${fmtInt(p.portalOrgs.enabled)} of ${fmtInt(p.portalOrgs.total)} organizations have portal access`,
      ],
      "No payments were received in this period."
    )
  );
  w.footer("Source: Zuper Payments (payment mode, source), Payment requests, Organizations (is_portal_enabled), Requests");
  w.notes = {
    purpose: "How customers pay and self-serve: online payment share, Customer Portal use and Zuper Pay payment requests.",
    callouts: compact([
      p.online.total > 0 && onlineShare < 0.2 && `Only ${pct(onlineShare)} of payments are online — Zuper Pay payment links and card-on-file are the lever.`,
      p.online.total > 0 && onlineShare >= 0.5 && `${pct(onlineShare)} of payments are already online — a good adoption story.`,
      p.portalOrgs && p.portalOrgs.total > 0 && p.portalOrgs.enabled / p.portalOrgs.total < 0.5 && `Portal access is on for only ${fmtInt(p.portalOrgs.enabled)} of ${fmtInt(p.portalOrgs.total)} organizations — turning it on lets B2B customers see jobs, invoices and pay themselves.`,
      p.paymentRequests && `${fmtInt(p.paymentRequests.count)} Zuper Pay payment requests on the account (${fmtInt(p.paymentRequests.inPeriod)} this period).`,
    ]),
    metrics: [
      { label: "Paid online", value: pct(onlineShare, 1), definition: "Payments in the period with payment_mode_type ONLINE ÷ all payments in the period, by amount.", source: "Zuper Payments", evidence: "Observed activity" },
      { label: "Paid via Customer Portal", value: p.portalPayments ? fmtMoneyCompact(p.portalPayments.amount) : "—", definition: "Payments in the period whose source contains 'portal'.", source: "Zuper Payments (source)", evidence: p.portalPayments ? "Observed activity" : "Insufficient data" },
      { label: "Payment requests", value: p.paymentRequests ? fmtInt(p.paymentRequests.count) : "—", definition: "Payment requests / links on the account; 'this period' by created date.", source: "Zuper /payments/payment_request", evidence: "Observed activity" },
      { label: "Organizations with portal access", value: p.portalOrgs ? `${p.portalOrgs.enabled} / ${p.portalOrgs.total}` : "—", definition: "Organizations with is_portal_enabled = true.", source: "Zuper Organizations", evidence: "Current state" },
    ],
    caveats: ["Portal logins and page views aren't exposed by the API — only enablement and portal-sourced payments/requests.", "ONLINE payment mode is the closest proxy for Zuper Pay; card payments processed outside Zuper may also be recorded as online.", ctx.syncLine],
  };
  return w;
}

// ---- Zuper Connect & CSR Agent ---------------------------------------------------------------------

export function connectSlide(ctx: Ctx, calls: ModuleAnalysis | undefined, sms: ModuleAnalysis | undefined, coverage: CoverageRow[]): ShapeWriter {
  const w = new ShapeWriter();
  w.header("Zuper Connect & CSR Agent", "Business calls and text conversations through Zuper Connect");
  const callCov = coverage.find((c) => c.module === "connect_calls");
  if (!calls && !sms) {
    const box = w.card(CONTENT_X, KPI_Y, CONTENT_W, 4480000, "CONNECT DATA");
    const why = callCov ? `${callCov.message ?? callCov.status}` : "Not synced yet";
    w.empty(box, `No Zuper Connect call or text data for this account (${why}). If they use Connect, check it's enabled and the API key has access; if not, Connect + CSR Agent is a clear opportunity.`);
    w.insight("Zuper Connect brings calls and texts into the job record; CSR Agent answers overflow and after-hours calls and books work directly.");
    w.footer("Source: Zuper Connect (telephony calls & SMS conversations)");
    w.notes = {
      purpose: "Customer communication through Zuper Connect, including calls the AI CSR Agent handles.",
      callouts: ["No Connect data came back — confirm with the customer whether they use Connect today."],
      talkingPoints: ["Ask how inbound calls are handled after hours and during surges — missed calls are missed jobs. This is the CSR Agent conversation."],
      caveats: [callCov ? `Connect sync status: ${callCov.status}${callCov.message ? ` — ${callCov.message}` : ""}.` : "Connect wasn't synced.", "AI call summaries and CSR Agent settings aren't exposed by the API."],
    };
    return w;
  }
  const hl = [...(calls?.highlights ?? [])];
  w.kpis(KPI_Y, [
    { value: calls ? fmtInt(calls.total) : "—", label: "Calls synced (all-time)" },
    ...hl.slice(0, 3).map((x) => ({ value: x.value, label: x.label, alert: x.alert })),
    { value: sms ? fmtInt(sms.total) : "—", label: "Text conversations" },
  ].slice(0, 5));
  const a = w.card(left.x, left.y, left.cx, left.cy, "CALLS PER MONTH");
  if (calls?.monthly.some((m) => m.count)) w.chart(a.x, a.y, a.cx, a.cy, { kind: "column", categories: calls.monthly.map((m) => m.label), series: [{ name: "Calls", values: calls.monthly.map((m) => m.count), color: SERIES[0] }] });
  else w.empty(a, "No calls in this period");
  const dim = calls?.breakdowns[0];
  const b = w.card(right.x, right.y, right.cx, right.cy, dim ? `CALLS BY ${dim.label.toUpperCase()}` : "TEXT CONVERSATIONS");
  if (dim) w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: dim.values.map((v) => truncate(v.name.replace(/_/g, " "), 24)), series: [{ name: "Calls", values: dim.values.map((v) => v.count), color: SERIES[1] }] });
  else w.empty(b, sms ? `${fmtInt(sms.total)} text conversations synced` : "No breakdown available");
  const missed = hl.find((x) => x.label.startsWith("Missed"));
  w.insight(
    sentence(
      [
        calls && `${fmtInt(calls.inPeriod ?? 0)} calls in the period`,
        missed && Number(missed.value.replace(/,/g, "")) > 0 && `${missed.value} missed or unanswered — calls CSR Agent is built to catch`,
        sms && `${fmtInt(sms.total)} text conversations`,
      ],
      "No Connect activity in this period."
    )
  );
  w.footer("Source: Zuper Connect — telephony calls & SMS conversations (connect host)");
  w.notes = {
    purpose: "Customer communication through Zuper Connect, including calls the AI CSR Agent handles.",
    callouts: compact([
      ...hl.map((x) => `${x.label}: ${x.value}.`),
      dim && `Most common ${dim.label.toLowerCase()}: ${dim.values[0].name} (${fmtInt(dim.values[0].count)}).`,
    ]),
    talkingPoints: ["Missed and after-hours calls are lost jobs — use the missed count to size the CSR Agent opportunity."],
    metrics: [
      ...(calls ? [{ label: "Calls", value: fmtInt(calls.total), definition: `Call records returned by Zuper Connect${calls.coverage.truncated ? " (capped)" : ""}; 'in period' by created_at.`, source: "Zuper Connect /telephony/calls", evidence: "Observed activity" as const }] : []),
      ...hl.map((x) => ({ label: x.label, value: x.value, definition: x.definition, source: "Zuper Connect", evidence: "Observed activity" as const })),
      ...(sms ? [{ label: "Text conversations", value: fmtInt(sms.total), definition: "Conversation threads returned by Zuper Connect.", source: "Zuper Connect /telephony/message/conversations", evidence: "Observed activity" as const }] : []),
    ],
    caveats: ["Connect endpoints and fields were mapped from Zuper's API docs; confirm counts against the Connect inbox before quoting them.", "AI call summaries and CSR Agent settings aren't exposed by the API.", ctx.syncLine],
  };
  return w;
}

// ---- One slide per catalog module --------------------------------------------------------------------

export function moduleSlide(ctx: Ctx, m: ModuleAnalysis): ShapeWriter {
  const w = new ShapeWriter();
  const dated = m.inPeriod != null;
  w.header(m.label, `${m.area}  ·  ${dated ? `created ${period(ctx.range)} vs all-time` : "current snapshot"}`);
  const tiles: { value: string; label: string; alert?: boolean }[] = [{ value: fmtInt(m.total), label: m.coverage.truncated ? "Records (capped)" : "Records (all-time)" }];
  if (dated) tiles.push({ value: fmtInt(m.inPeriod!), label: "Created in the period" });
  if (m.amount) tiles.push({ value: fmtMoneyCompact(dated ? m.amount.inPeriod : m.amount.total), label: `${m.amount.label}${dated ? " (period)" : ""}` });
  for (const h of m.highlights) if (tiles.length < 5) tiles.push({ value: h.value, label: h.label, alert: h.alert });
  const top = m.breakdowns[0];
  if (tiles.length < 5 && top) tiles.push({ value: pct(top.values[0].count / Math.max(top.filled, 1)), label: truncate(`${top.values[0].name.replace(/_/g, " ")} (${top.label.toLowerCase()})`, 40) });
  w.kpis(KPI_Y, tiles);

  const a = w.card(left.x, left.y, left.cx, left.cy, dated ? "CREATED PER MONTH" : top ? `BY ${top.label.toUpperCase()}` : "DETAIL");
  if (dated && m.monthly.some((x) => x.count)) w.chart(a.x, a.y, a.cx, a.cy, { kind: "column", categories: m.monthly.map((x) => x.label), series: [{ name: m.label, values: m.monthly.map((x) => x.count), color: SERIES[0] }] });
  else if (!dated && top) w.chart(a.x, a.y, a.cx, a.cy, { kind: "bar", categories: top.values.map((v) => truncate(v.name.replace(/_/g, " "), 26)), series: [{ name: "Records", values: top.values.map((v) => v.count), color: SERIES[0] }] });
  else w.empty(a, dated ? "None created in this period" : m.describe);

  const second = dated ? top : m.breakdowns[1];
  if (second) {
    const b = w.card(right.x, right.y, right.cx, right.cy, `BY ${second.label.toUpperCase()}`);
    w.chart(b.x, b.y, b.cx, b.cy, { kind: "bar", categories: second.values.map((v) => truncate(v.name.replace(/_/g, " "), 26)), series: [{ name: "Records", values: second.values.map((v) => v.count), color: SERIES[1] }] });
  } else textCard(w, right, "ABOUT THIS MODULE", [m.describe, ...m.highlights.map((h) => `${h.label}: ${h.value}`)]);

  w.insight(
    sentence(
      [
        `${fmtInt(m.total)} ${m.label.toLowerCase()} on the account`,
        dated && `${fmtInt(m.inPeriod!)} created this period`,
        top && `most common ${top.label.toLowerCase()}: ${top.values[0].name.replace(/_/g, " ")} (${fmtInt(top.values[0].count)})`,
        m.amount && `${m.amount.label.toLowerCase()} ${fmtMoneyCompact(dated ? m.amount.inPeriod : m.amount.total)}`,
      ],
      m.describe
    )
  );
  w.footer(`Source: Zuper ${m.coverage.endpoint} · ${m.coverage.truncated ? "capped sample · " : ""}synced ${fmtDate(m.coverage.fetchedAt)}`);

  w.notes = {
    purpose: m.describe,
    callouts: compact([
      ...m.highlights.map((h) => `${h.label}: ${h.value}.`),
      top && `${top.label}: ${top.values.slice(0, 3).map((v) => `${v.name.replace(/_/g, " ")} ${fmtInt(v.count)}`).join(", ")}.`,
      dated && m.inPeriod === 0 && "Nothing was created in this period — is this area of Zuper still in use?",
    ]),
    metrics: [
      { label: "Records", value: fmtInt(m.total), definition: m.coverage.truncated ? `First ${fmtInt(m.total)} records returned (capped; Zuper reports ${m.coverage.totalRecords != null ? fmtInt(m.coverage.totalRecords) : "more"}).` : "Every record the endpoint returned at sync time.", source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" },
      ...(dated ? [{ label: "Created in the period", value: fmtInt(m.inPeriod!), definition: "Records whose created/primary date falls in the report period.", source: `Zuper ${m.coverage.endpoint}`, evidence: "Observed activity" as const }] : []),
      ...(m.amount ? [{ label: m.amount.label, value: fmtMoneyCompact(dated ? m.amount.inPeriod : m.amount.total), definition: `Sum of field "${m.amount.field}"${dated ? " for records created in the period" : " across all records"} (present on ${fmtInt(m.amount.filled)} records). All-time total: ${fmtMoneyCompact(m.amount.total)}.`, source: `Zuper ${m.coverage.endpoint}`, evidence: "Observed activity" as const }] : []),
      ...m.breakdowns.map((bd) => ({ label: `By ${bd.label.toLowerCase()}`, definition: `Count of records by field "${bd.field}" (present on ${fmtInt(bd.filled)} of ${fmtInt(m.total)} records).`, source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" as const })),
      ...m.highlights.map((h) => ({ label: h.label, value: h.value, definition: h.definition, source: `Zuper ${m.coverage.endpoint}`, evidence: "Current state" as const })),
    ],
    caveats: compact([
      "This module's field names come from Zuper's API reference and the data itself; check a couple of records in Zuper before quoting exact figures.",
      m.coverage.truncated && `Capped at ${fmtInt(m.total)} records — totals are a floor.`,
      m.coverage.topFields.length > 0 && `Most-filled fields: ${m.coverage.topFields.slice(0, 8).map((f) => f.path).join(", ")}.`,
    ]),
    editBeforePresenting: ["Delete this slide if the module isn't relevant to this customer's review."],
  };
  return w;
}

// ---- Data coverage -------------------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  ok: "Data synced",
  empty: "In API — no records",
  not_available: "Not enabled / no access",
  error: "Error",
  not_in_api: "Not in the API",
  skipped: "Skipped",
};

export function coverageSlides(ctx: Ctx, rows: CoverageRow[]): ShapeWriter[] {
  const perSlide = 13;
  const pages = Math.max(1, Math.ceil(rows.length / perSlide));
  const withData = rows.filter((r) => r.status === "ok").length;
  const out: ShapeWriter[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = rows.slice(p * perSlide, (p + 1) * perSlide);
    const w = new ShapeWriter();
    w.header(
      `Data Coverage${pages > 1 ? ` (${p + 1} of ${pages})` : ""}`,
      rows.length ? `${withData} of ${rows.length} Zuper modules returned data for ${ctx.customerName}` : "Not recorded yet — run Sync from Zuper to capture coverage for every module"
    );
    const y0 = 1300000;
    const h = 4480000;
    w.rect(CONTENT_X, y0, CONTENT_W, h, COLORS.white, { radius: 3000, border: COLORS.border });
    const cols = [
      { label: "MODULE", x: 0.02, w: 0.25 },
      { label: "AREA", x: 0.27, w: 0.19 },
      { label: "STATUS", x: 0.46, w: 0.17 },
      { label: "RECORDS", x: 0.63, w: 0.09 },
      { label: "NOTE", x: 0.72, w: 0.27 },
    ];
    cols.forEach((c) => w.text(CONTENT_X + CONTENT_W * c.x, y0 + 120000, CONTENT_W * c.w, 220000, run(c.label, { sz: 800, color: COLORS.faint, bold: true }), { wrap: "none" }));
    const rowH = (h - 480000) / perSlide;
    slice.forEach((r, i) => {
      const y = y0 + 400000 + i * rowH;
      if (i % 2 === 0) w.rect(CONTENT_X + 60000, y - 20000, CONTENT_W - 120000, rowH, "F7F7F5");
      const color = r.status === "ok" ? COLORS.ink : r.status === "error" ? COLORS.alert : COLORS.muted;
      const cells = [
        run(truncate(r.label, 34), { sz: 900, color: COLORS.ink, bold: true }),
        run(r.area, { sz: 850, color: COLORS.muted }),
        run(STATUS_LABEL[r.status] ?? r.status, { sz: 850, color }),
        run(r.status === "ok" ? `${fmtInt(r.recordCount)}${r.truncated ? "+" : ""}` : "—", { sz: 850, color: COLORS.ink }),
        run(truncate(r.message ?? "", 60), { sz: 750, color: COLORS.muted }),
      ];
      cols.forEach((c, j) => w.text(CONTENT_X + CONTENT_W * c.x, y, CONTENT_W * c.w - 60000, rowH - 30000, cells[j], { anchor: "ctr" }));
    });
    w.insight(p === 0 ? `Every module the account's API exposes was requested. "Not in the API" areas can't be measured this way — confirm usage with the customer rather than assuming non-use.` : "Continued.");
    w.footer("Source: Zuper API — every list endpoint in Zuper's API reference, requested with this account's key at sync time");
    w.notes = {
      purpose: "Exactly what data this deck is built on: which Zuper modules returned data, which were empty, which aren't enabled, and which aren't exposed by the API at all.",
      callouts: compact([
        p === 0 && `${withData} modules returned data.`,
        ...slice.filter((r) => r.status === "not_available").map((r) => `${r.label}: not enabled or no API access — ask if they use it.`),
        ...slice.filter((r) => r.status === "error").map((r) => `${r.label}: sync error (${r.message ?? "unknown"}) — re-sync before relying on it.`),
      ]),
      metrics: [
        { label: "Status", definition: "Data synced = records returned; In API — no records = endpoint worked but the account has none; Not enabled / no access = 401/403/404 for this key; Not in the API = the product has no account-API endpoint.", source: "Sync results", evidence: "Current state" },
        { label: "Records", definition: "Records stored from that module ('+' = capped; Zuper reported more).", source: "Sync results", evidence: "Current state" },
      ],
      caveats: ["An empty or unavailable module is not proof the customer doesn't use that feature — permissions and plan limits also cause it (SPEC §14.3).", ctx.syncLine],
      editBeforePresenting: ["This slide is for the CSM's preparation — hide it before presenting if the customer doesn't need it."],
    };
    out.push(w);
  }
  return out;
}

/** Inserts slides in order after `after`; returns the last inserted slide path. */
export async function insertChain(zip: JSZip, after: string, slides: (ShapeWriter | null)[]): Promise<string> {
  let cur = after;
  for (const s of slides) if (s) cur = await insertGeneratedSlide(zip, cur, s);
  return cur;
}
