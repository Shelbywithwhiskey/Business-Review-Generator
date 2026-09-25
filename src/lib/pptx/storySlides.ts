import type { DateRange } from "@/lib/zuper/modules";
import type { IndustryResult, MetricKey } from "@/lib/reports/industry";
import type { Journey, JourneyMetric } from "@/lib/reports/journey";
import type { Callout, Tone } from "@/lib/reports/callouts";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, fmtMoneyCompact, run, truncate } from "./generatedSlide";

// ---------------------------------------------------------------------------
// Story slides: the industry lens, the account's journey on Zuper, then-vs-now
// (what got better), growth since go-live, and the work / money flow. Visual
// forms follow the job of the data: dumbbells for before→after, a timeline for
// milestones, area trends for growth, stepped flows for the funnel — never a
// dual axis. Numbers come from reports/journey.ts and the shared deck metrics.
// ---------------------------------------------------------------------------

interface Ctx {
  customerName: string;
  range: DateRange;
  syncLine: string;
}

const TONE_INK: Record<Tone, string> = { win: "0B7A0B", risk: "B5271C", opportunity: "C03D00", watch: "4B5563" };
const TONE_WORD: Record<Tone, string> = { win: "STRENGTH", risk: "RISK", opportunity: "OPPORTUNITY", watch: "WATCH" };
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export interface MetricReading {
  value: string;
  note: string;
  tone: Tone;
}

// ---- 1. Industry lens --------------------------------------------------------------------------

export function industrySlide(ctx: Ctx, ind: IndustryResult, readings: Partial<Record<MetricKey, MetricReading | null>>, narrative: string): ShapeWriter {
  const w = new ShapeWriter();
  const titleCase = ind.label.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  w.header(`${truncate(ctx.customerName, 40)} — Through a ${titleCase} Lens`, `What matters most in ${ind.label.toLowerCase()}, and where this account stands`);

  // Left: business profile.
  const lx = CONTENT_X;
  const lw = CONTENT_W * 0.36;
  const top = 1300000;
  const h = 4450000;
  const inner = w.card(lx, top, lw, h, "THE BUSINESS");
  w.text(inner.x + 60000, inner.y + 20000, inner.cx - 120000, 380000, run(ind.label, { sz: 1600, color: COLORS.ink, bold: true }));
  w.text(inner.x + 60000, inner.y + 420000, inner.cx - 120000, 700000, run(ind.model, { sz: 1000, color: COLORS.muted }));
  w.text(inner.x + 60000, inner.y + 1150000, inner.cx - 120000, 200000, run("WHAT THEY DO IN ZUPER", { sz: 800, color: COLORS.faint, bold: true }));
  ind.services.slice(0, 5).forEach((s, i) => {
    w.rect(inner.x + 60000, inner.y + 1400000 + i * 300000 + 80000, 60000, 60000, COLORS.orange, { radius: 50000 });
    w.text(inner.x + 180000, inner.y + 1400000 + i * 300000, inner.cx - 240000, 240000, run(truncate(s, 40), { sz: 1000, color: COLORS.ink }), { anchor: "ctr", wrap: "none" });
  });
  if (ind.seasonality) w.text(inner.x + 60000, inner.y + h - 1250000, inner.cx - 120000, 600000, run(`Seasonality: ${ind.seasonality}`, { sz: 900, color: COLORS.muted }));

  // Right: what matters → their number.
  const rx = lx + lw + 150000;
  const rw = CONTENT_W - lw - 150000;
  const matters = ind.whatMatters.slice(0, 4);
  const rowH = (h - 1150000) / Math.max(matters.length, 1);
  w.text(rx, top, rw, 240000, run("WHAT MATTERS MOST IN THIS TRADE  →  THIS ACCOUNT", { sz: 900, color: COLORS.white, bold: true }), { wrap: "none" });
  matters.forEach((m, i) => {
    const y = top + 330000 + i * rowH;
    const r = readings[m.metric];
    w.rect(rx, y, rw, rowH - 90000, COLORS.white, { radius: 6000, border: COLORS.border });
    w.text(rx + 180000, y + 90000, rw * 0.55, 260000, run(METRIC_TITLES[m.metric], { sz: 1150, color: COLORS.ink, bold: true }), { wrap: "none" });
    w.text(rx + 180000, y + 360000, rw * 0.58, rowH - 480000, run(`Why: ${m.why}`, { sz: 850, color: COLORS.muted }));
    const vx = rx + rw * 0.62;
    if (r) {
      w.text(vx, y + 60000, rw * 0.36, 380000, run(r.value, { sz: 1800, color: TONE_INK[r.tone], bold: true }), { wrap: "none" });
      w.text(vx, y + 440000, rw * 0.36, rowH - 560000, run(r.note, { sz: 850, color: COLORS.muted }));
    } else w.text(vx, y + 120000, rw * 0.36, 400000, run("Not measurable from this account's data yet", { sz: 900, color: COLORS.faint }));
  });
  const ny = top + 330000 + matters.length * rowH;
  w.rect(rx, ny, rw, top + h - ny, "FFF6F0", { radius: 6000 });
  w.text(rx + 180000, ny + 60000, rw - 360000, top + h - ny - 120000, run(truncate(narrative, 330), { sz: 950, color: COLORS.ink }), { anchor: "ctr" });

  const cos: Callout[] = [];
  for (const m of matters) {
    const r = readings[m.metric];
    if (r && (r.tone === "risk" || r.tone === "opportunity"))
      cos.push({ tone: r.tone, headline: `${METRIC_TITLES[m.metric]}: ${r.value}`, detail: `${r.note} — in ${ind.label.toLowerCase()} this matters because ${m.why}.`, score: 52, area: "Industry lens" });
    if (r && r.tone === "win") cos.push({ tone: "win", headline: `${METRIC_TITLES[m.metric]}: ${r.value}`, detail: `${r.note} — a strength in a trade where ${m.why}.`, score: 40, area: "Industry lens" });
  }
  w.callouts = cos;
  w.footer(`Trade detected from: ${ind.signals.slice(0, 3).join("; ") || "account data"}${ind.confidence === "low" ? " (low confidence — check)" : ""}`);
  w.notes = {
    purpose: `Frames the review in the customer's own trade: what a ${ind.label.toLowerCase()} business lives or dies by, and this account's number on each.`,
    callouts: cos.map((c) => `${TONE_WORD[c.tone]}: ${c.headline} — ${c.detail}`),
    talkingPoints: [
      "Open with their world, not Zuper's: 'In your business, these four things decide growth — here's where you are on each.'",
      ...ind.plays.slice(0, 3).map((p) => `Where Zuper fits: ${p.feature} — ${p.why}.`),
    ],
    metrics: matters.map((m) => ({ label: METRIC_TITLES[m.metric], value: readings[m.metric]?.value, definition: `${readings[m.metric]?.note ?? "Not measurable from the synced data."} Why it matters: ${m.why}.`, source: "Computed from this account's Zuper data", evidence: readings[m.metric] ? ("Observed activity" as const) : ("Insufficient data" as const) })),
    caveats: [
      `Trade detection (${ind.confidence} confidence) used: ${ind.signals.join("; ") || "no strong signals"}.`,
      "The 'what matters' list is qualitative guidance for this trade — no industry benchmark numbers are claimed.",
      "The summary paragraph may be AI-written from the website for framing; every number in it is checked against the computed figures.",
      ctx.syncLine,
    ],
    editBeforePresenting: ind.confidence === "low" ? ["The trade couldn't be identified confidently — correct the label or delete this slide."] : undefined,
  };
  return w;
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  quoteAcceptance: "Quote close rate",
  staleQuotes: "Quotes waiting on a decision",
  callAnswerRate: "Inbound calls answered",
  missedCalls: "Missed inbound calls",
  onTime: "Work completed on schedule",
  recurringShare: "Recurring work",
  collectionRate: "Collections",
  daysToPay: "Days to get paid",
  onlinePayShare: "Paid online",
  workflowHealth: "Automation health",
  jobGrowth: "Job volume trend",
  repeatCustomers: "Repeat customers",
  cycleTime: "Job cycle time",
  backlog: "Work waiting to be scheduled",
  organizations: "Key B2B clients",
};

// ---- 2. Journey on Zuper ---------------------------------------------------------------------------

export function journeySlide(ctx: Ctx, j: Journey, narrative: string): ShapeWriter {
  const w = new ShapeWriter();
  w.header(`${truncate(ctx.customerName, 44)}'s Journey with Zuper`, j.goLive ? `On Zuper since ${fmtDate(j.goLive)}  ·  ${j.monthsOnZuper} months of operating history` : "No activity yet");
  // Only show money totals for modules the account really runs in Zuper (a $31 test quote isn't a story).
  const heroes: [string, string][] = [
    [fmtInt(j.totals.jobs), "jobs run through Zuper"],
    [fmtInt(j.totals.completed), "jobs completed"],
    ...(j.uses.quotes ? [[fmtMoneyCompact(j.totals.quoteValue), `quoted across ${fmtInt(j.totals.quotes)} quotes`] as [string, string]] : []),
    ...(j.uses.invoices ? [[fmtMoneyCompact(j.totals.invoiced), `invoiced · ${fmtMoneyCompact(j.totals.collected)} collected`] as [string, string]] : []),
    ...(j.totals.customersAdded > 0 ? [[fmtInt(j.totals.customersAdded), "customers added"] as [string, string]] : []),
    [fmtInt(j.monthsOnZuper), "months on Zuper"],
  ].slice(0, 4) as [string, string][];
  const hw = CONTENT_W / heroes.length;
  heroes.forEach(([v, c], i) => w.hero(CONTENT_X + i * hw + 60000, 1350000, hw - 120000, v, c, COLORS.white, "F8D9CB"));
  // Timeline across the middle.
  const items = j.milestones.slice(0, 7).map((m) => ({ date: fmtDate(m.date), label: m.label }));
  w.timeline(CONTENT_X + 500000, 3650000, CONTENT_W - 1000000, items);
  w.rect(CONTENT_X, 4700000, CONTENT_W, 1050000, COLORS.white, { radius: 6000 });
  w.text(CONTENT_X + 200000, 4760000, 2000000, 220000, run("THE STORY SO FAR", { sz: 850, color: COLORS.orange, bold: true }), { wrap: "none" });
  w.text(CONTENT_X + 200000, 4990000, CONTENT_W - 400000, 720000, run(truncate(narrative, 360), { sz: 1000, color: COLORS.ink }));
  const cos: Callout[] = [];
  if (j.goLive && j.totals.jobs > 0)
    cos.push({
      tone: "win",
      headline: `${fmtInt(j.totals.jobs)} jobs${j.uses.invoices ? ` and ${fmtMoneyCompact(j.totals.invoiced)} invoiced` : ""} through Zuper since ${fmtDate(j.goLive)}`,
      detail: "Zuper is the operating system for the business, not a side tool.",
      score: 46,
      area: "Journey",
    });
  if (!j.uses.quotes && !j.uses.invoices && j.totals.jobs > 100)
    cos.push({ tone: "opportunity", headline: "Quoting and invoicing run outside Zuper", detail: `the ${fmtInt(j.totals.jobs)} jobs in Zuper aren't connected to quotes, invoices or payments — bringing billing in closes the loop from job to cash.`, score: 58, area: "Journey" });
  w.callouts = cos;
  w.footer("Totals are since the account's first record in Zuper up to the report end · milestones are the first record of each kind");
  w.notes = {
    purpose: "The partnership story in the customer's own data: when they started, what they've run through Zuper, and when each capability came online.",
    talkingPoints: ["Walk the timeline left to right — each milestone is a capability they switched on. Pause on the one that changed how they work most."],
    metrics: [
      { label: "On Zuper since", value: j.goLive ? fmtDate(j.goLive) : "—", definition: "Month of the earliest job, quote or invoice in the synced data.", source: "Zuper Jobs, Quotes, Invoices", evidence: "Observed activity" },
      { label: "Totals", definition: "All jobs, quotes, non-voided invoices and amounts collected from the start to the report end.", source: "Zuper Jobs, Quotes, Invoices", evidence: "Observed activity" },
      { label: "Milestones", definition: "First record of each kind (first quote, first online payment, first automation, first Connect call...).", source: "Zuper records", evidence: "Observed activity" },
    ],
    caveats: ["Records imported from a previous system would appear as early activity — confirm the go-live month with the customer.", ctx.syncLine],
  };
  return w;
}

// ---- 3. Then vs now -------------------------------------------------------------------------------

function metricText(m: JourneyMetric, v: number): string {
  if (m.unit === "pct") return pct(v);
  if (m.unit === "money") return fmtMoneyCompact(v);
  if (m.unit === "days") return `${v.toFixed(v < 10 ? 1 : 0)} d`;
  return fmtInt(v);
}

function deltaText(m: JourneyMetric): string {
  if (m.unit === "pct") return `${m.change >= 0 ? "+" : "−"}${Math.abs(m.change * 100).toFixed(0)} pts`;
  return `${m.change >= 0 ? "+" : "−"}${Math.abs(m.change * 100).toFixed(0)}%`;
}

export function thenNowSlide(ctx: Ctx, j: Journey): ShapeWriter {
  const w = new ShapeWriter();
  const early = j.metrics[0]?.earlyLabel;
  const now = j.metrics[0]?.nowLabel;
  w.header("Then vs Now — What Got Better on Zuper", early ? `First months on Zuper (${early}) vs latest (${now})` : "Comparing the early months on Zuper with today");
  const box = { x: CONTENT_X, y: 1300000, cx: CONTENT_W, cy: 4450000 };
  w.rect(box.x, box.y, box.cx, box.cy, COLORS.white, { radius: 4000, border: COLORS.border });
  const rows = [...j.metrics].sort((a, b) => Number(b.improved) - Number(a.improved)).slice(0, 8);
  if (!rows.length) {
    w.empty(box, j.limitation ?? "Not enough history to compare yet.");
  } else {
    w.text(box.x + 200000, box.y + 120000, 900000, 200000, run("● THEN", { sz: 850, color: "9CA3AF", bold: true }), { wrap: "none" });
    w.text(box.x + 1000000, box.y + 120000, 900000, 200000, run("● NOW", { sz: 850, color: COLORS.orange, bold: true }), { wrap: "none" });
    // Fixed row height, block centred — a couple of rows shouldn't float at the top of an empty card.
    const rowH = Math.min(520000, (box.cy - 420000) / rows.length);
    const top = box.y + 380000 + Math.max(0, (box.cy - 420000 - rows.length * rowH) / 2);
    rows.forEach((m, i) => {
      w.dumbbell(box.x + 200000, top + i * rowH, box.cx - 400000, {
        label: m.label,
        before: m.early,
        after: m.now,
        beforeText: metricText(m, m.early),
        afterText: metricText(m, m.now),
        improved: m.improved,
        delta: deltaText(m),
      });
    });
  }
  const better = j.metrics.filter((m) => m.improved);
  const worse = j.metrics.filter((m) => !m.improved);
  const mag = (m: JourneyMetric) => Math.abs(m.unit === "pct" ? m.change * 3 : m.change);
  const cos: Callout[] = [
    ...better
      .sort((a, b) => mag(b) - mag(a))
      .slice(0, 2)
      .map((m) => ({ tone: "win" as const, headline: `${m.label}: ${metricText(m, m.early)} → ${metricText(m, m.now)} (${deltaText(m)})`, detail: `${m.earlyLabel} vs ${m.nowLabel} — better since the early months on Zuper.`, score: 60 + Math.min(15, mag(m) * 10), area: "Journey" })),
    ...worse
      .sort((a, b) => mag(b) - mag(a))
      .slice(0, 1)
      .map((m) => ({ tone: "watch" as const, headline: `${m.label}: ${metricText(m, m.early)} → ${metricText(m, m.now)} (${deltaText(m)})`, detail: "moved the wrong way since the early months — worth a conversation.", score: 50, area: "Journey" })),
  ];
  w.keyCallouts(cos, j.limitation ?? "Early months on Zuper compared with the latest months.");
  w.footer("Each row: 3-month windows · quote & collection rows use settled months only (45+ days old) · change is observed, not attributed");
  w.notes = {
    purpose: "What changed in the operation between the first months on Zuper and now — the evidence for the value conversation.",
    talkingPoints: [
      "Lead with what got better and let the customer explain why — their explanation is the value story.",
      "Say 'since moving onto Zuper', not 'because of Zuper' — other things changed too (team, season, demand).",
    ],
    metrics: j.metrics.map((m) => ({ label: m.label, value: `${metricText(m, m.early)} → ${metricText(m, m.now)} (${deltaText(m)})`, definition: `${m.definition} Then = ${m.earlyLabel}; now = ${m.nowLabel}.`, source: "Computed from this account's Zuper records", evidence: "Observed change" as const })),
    caveats: compactList([
      j.limitation,
      "The first month on Zuper is treated as onboarding and left out of the 'then' window.",
      "Seasonality can explain part of any change — compare like-for-like months when a full year is available.",
      ctx.syncLine,
    ]),
  };
  return w;
}

function compactList(xs: (string | null | undefined)[]): string[] {
  return xs.filter((x): x is string => !!x);
}

// ---- 4. Growth since go-live -------------------------------------------------------------------------

export function growthSlide(ctx: Ctx, j: Journey): ShapeWriter | null {
  const months = j.months.slice(-18);
  if (months.length < 3) return null;
  const w = new ShapeWriter();
  w.header("Growth Since Go-Live", `Monthly activity in Zuper, ${months[0].label} – ${months[months.length - 1].label}`);
  const gap = 150000;
  const half = (CONTENT_W - gap) / 2;
  const a = w.card(CONTENT_X, 1300000, half, 4450000, "JOBS COMPLETED PER MONTH");
  w.chart(a.x, a.y, a.cx, a.cy, { kind: "area", categories: months.map((m) => m.label), series: [{ name: "Jobs completed", values: months.map((m) => m.jobsCompleted), color: "FD5000" }] });
  const b = w.card(CONTENT_X + half + gap, 1300000, half, 4450000, j.uses.invoices ? "INVOICED PER MONTH" : "JOBS CREATED PER MONTH");
  if (j.uses.invoices)
    w.chart(b.x, b.y, b.cx, b.cy, { kind: "area", categories: months.map((m) => m.label), series: [{ name: "Invoiced", values: months.map((m) => Math.round(m.invoiced)), color: "2A78D6" }], numberFormat: "$#,##0" });
  else w.chart(b.x, b.y, b.cx, b.cy, { kind: "area", categories: months.map((m) => m.label), series: [{ name: "Jobs created", values: months.map((m) => m.jobsCreated), color: "2A78D6" }] });
  const peak = [...months].sort((x, y) => y.jobsCompleted - x.jobsCompleted)[0];
  const invPeak = [...months].sort((x, y) => y.invoiced - x.invoiced)[0];
  w.keyCallouts(
    [
      ...(peak.jobsCompleted > 0 ? [{ tone: "win" as const, headline: `Busiest month for completed work: ${peak.label} (${fmtInt(peak.jobsCompleted)} jobs)`, detail: "capacity the team has shown it can deliver.", score: 38, area: "Journey" }] : []),
      ...(j.uses.invoices && invPeak.invoiced > 0 ? [{ tone: "win" as const, headline: `Highest billing month: ${invPeak.label} (${fmtMoneyCompact(invPeak.invoiced)})`, detail: "billing activity, not profit.", score: 34, area: "Journey" }] : []),
    ],
    "Monthly jobs completed and invoice value since the account went live."
  );
  w.footer("Two separate charts (never one chart with two scales) · jobs by completion month · invoices by invoice date, voided excluded");
  w.notes = {
    purpose: "The shape of the business on Zuper month by month — growth, seasonality and ramp-up at a glance.",
    metrics: [
      { label: "Jobs completed per month", definition: "Jobs whose completion falls in each month.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Invoiced per month", definition: "Non-voided invoice value by invoice month.", source: "Zuper Invoices", evidence: "Observed activity" },
    ],
    caveats: ["The latest month may be partial.", ctx.syncLine],
  };
  return w;
}

// ---- 5. Work & money flow -----------------------------------------------------------------------------

export interface FlowInput {
  jobsCreated: number;
  jobsScheduled: number;
  jobsCompleted: number;
  quotedValue: number;
  quotesCount: number;
  acceptedValue: number;
  acceptedCount: number;
  invoicedValue: number;
  invoiceCount: number;
  collectedValue: number;
  /** False when quoting/invoicing aren't really run in Zuper — the money panel explains instead of showing zeros. */
  moneyInZuper: boolean;
}

export function flowSlide(ctx: Ctx, f: FlowInput): ShapeWriter {
  const w = new ShapeWriter();
  w.header("How Work and Money Flow Through Zuper", `${ctx.range.start.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} – ${ctx.range.end.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}  ·  each stage as recorded in Zuper`);
  const gap = 150000;
  const half = (CONTENT_W - gap) / 2;
  const a = w.card(CONTENT_X, 1300000, half, 4450000, "THE WORK: JOBS");
  const ratio = (x: number, y: number) => (y ? pct(x / y) : "—");
  w.funnel(a.x, a.y + 150000, a.cx, a.cy - 250000, [
    { label: "Created", value: f.jobsCreated, display: fmtInt(f.jobsCreated) },
    { label: "Scheduled", value: f.jobsScheduled, display: fmtInt(f.jobsScheduled), sub: `${ratio(f.jobsScheduled, f.jobsCreated)} of created` },
    { label: "Completed", value: f.jobsCompleted, display: fmtInt(f.jobsCompleted), sub: `${ratio(f.jobsCompleted, f.jobsCreated)} of created` },
  ]);
  const b = w.card(CONTENT_X + half + gap, 1300000, half, 4450000, "THE MONEY: QUOTE TO CASH");
  if (!f.moneyInZuper) {
    w.text(b.x + 100000, b.y + 300000, b.cx - 200000, 500000, run("Quoting and invoicing aren't run in Zuper yet", { sz: 1500, color: COLORS.ink, bold: true }));
    w.text(b.x + 100000, b.y + 900000, b.cx - 200000, 1600000, run(`${fmtInt(f.quotesCount)} quotes and ${fmtInt(f.invoiceCount)} invoices this period. The work is in Zuper, but the money isn't — so there's no line of sight from a finished job to an invoice and a payment. Bringing quotes, invoices and Zuper Pay in closes that loop.`, { sz: 1050, color: COLORS.muted }));
  } else
  w.funnel(b.x, b.y + 150000, b.cx, b.cy - 250000, [
    { label: "Quoted", value: f.quotedValue, display: fmtMoneyCompact(f.quotedValue), sub: `${fmtInt(f.quotesCount)} quotes` },
    { label: "Accepted", value: f.acceptedValue, display: fmtMoneyCompact(f.acceptedValue), sub: `${fmtInt(f.acceptedCount)} quotes · ${ratio(f.acceptedValue, f.quotedValue)} of quoted value` },
    { label: "Invoiced", value: f.invoicedValue, display: fmtMoneyCompact(f.invoicedValue), sub: `${fmtInt(f.invoiceCount)} invoices` },
    { label: "Collected", value: f.collectedValue, display: fmtMoneyCompact(f.collectedValue), sub: `${ratio(f.collectedValue, f.invoicedValue)} of invoiced` },
  ]);
  const leak = f.quotedValue ? 1 - f.acceptedValue / f.quotedValue : 0;
  w.keyCallouts(
    [
      ...(!f.moneyInZuper && f.jobsCompleted >= 50
        ? [{ tone: "opportunity" as const, headline: `${fmtInt(f.jobsCompleted)} jobs completed, but billing happens outside Zuper`, detail: "invoicing from the completed job (and Zuper Pay on the invoice) would connect the work to the cash.", score: 60, area: "Collections" }]
        : []),
      ...(f.moneyInZuper && f.quotedValue > 0 && leak > 0.6
        ? [{ tone: "opportunity" as const, headline: `${pct(leak)} of quoted value (${fmtMoneyCompact(f.quotedValue - f.acceptedValue)}) hasn't converted`, detail: "the widest gap in the flow — quote follow-up is where the money is.", score: 58, area: "Quotes" }]
        : []),
      ...(f.jobsCreated > 0 && f.jobsCompleted / f.jobsCreated < 0.5
        ? [{ tone: "watch" as const, headline: `${pct(f.jobsCompleted / f.jobsCreated)} of jobs created this period are completed`, detail: "check which stage work is waiting in on the lifecycle slide.", score: 36, area: "Jobs" }]
        : []),
      ...(f.moneyInZuper && f.invoicedValue > 0 && f.collectedValue / f.invoicedValue >= 0.85
        ? [{ tone: "win" as const, headline: `${pct(f.collectedValue / f.invoicedValue)} of invoiced value is collected`, detail: "once work is billed, it gets paid.", score: 34, area: "Collections" }]
        : []),
    ],
    "Jobs and money at each stage, as recorded in Zuper."
  );
  w.footer("Stages are counted independently for the period (an invoice isn't necessarily from a quote in the same period) · voided invoices excluded");
  w.notes = {
    purpose: "The whole operation on one slide: how much work moves from created to done, and how much money moves from quoted to collected.",
    talkingPoints: ["Point at the biggest drop between two bars — that's where to focus next quarter."],
    metrics: [
      { label: "Jobs: created / scheduled / completed", value: `${fmtInt(f.jobsCreated)} / ${fmtInt(f.jobsScheduled)} / ${fmtInt(f.jobsCompleted)}`, definition: "Jobs created in the period; of those, jobs that reached a Scheduled status and jobs now Completed/Closed.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Quoted → accepted", value: `${fmtMoneyCompact(f.quotedValue)} → ${fmtMoneyCompact(f.acceptedValue)}`, definition: "Value of all quotes dated in the period, and of those accepted/converted.", source: "Zuper Quotes", evidence: "Observed activity" },
      { label: "Invoiced → collected", value: `${fmtMoneyCompact(f.invoicedValue)} → ${fmtMoneyCompact(f.collectedValue)}`, definition: "Non-voided invoices dated in the period, and amount paid against them so far.", source: "Zuper Invoices", evidence: "Observed activity" },
    ],
    caveats: ["The money stages aren't a strict funnel — invoices can come from work quoted in an earlier period or not quoted at all.", ctx.syncLine],
  };
  return w;
}
