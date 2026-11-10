import type { DateRange } from "@/lib/zuper/modules";
import type { CustomerRevenue, SpeedEfficiency, SpeedMetric, TeamProductivity } from "@/lib/reports/insights";
import { topAcross, type Callout } from "@/lib/reports/callouts";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, fmtMoneyCompact, run, truncate } from "./generatedSlide";

// ---------------------------------------------------------------------------
// Account-view pages: Customers & Revenue, Team Productivity, Speed &
// Efficiency, and "What Could Be Done Better". Each builder returns null when
// the account has too little data, so the page is simply left out.
// Every call-out names the account's own numbers and, where it's a problem or
// an opening, carries the concrete next step in `action`.
// ---------------------------------------------------------------------------

export interface InsightCtx {
  customerName: string;
  range: DateRange;
  syncLine: string;
}

const KPI_Y = 1300000;
const BODY_Y = 2260000;
const BODY_H = 3480000;
const GAP = 150000;
const SERIES = ["FD5000", "2A78D6", "1BAF7A", "4A3AA7"];

type Maybe = Callout | null | undefined | false | 0 | "";
const co = (xs: Maybe[]): Callout[] => xs.filter((x): x is Callout => !!x && typeof x === "object");
const pct0 = (n: number) => `${Math.round(n * 100)}%`;
const fmtDate = (d: Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const period = (r: DateRange) => `${fmtDate(r.start)} – ${fmtDate(r.end)}`;
const names = (xs: { name: string }[], n = 3) => xs.slice(0, n).map((x) => x.name).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
const days = (d: number | null) => (d == null ? "—" : d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d.toFixed(d < 10 ? 1 : 0)} days`);

/** Simple table inside a box: header row + body rows, columns as fractions of the width. */
function table(w: ShapeWriter, box: { x: number; y: number; cx: number; cy: number }, cols: { label: string; w: number; align?: "l" | "r" }[], rows: string[][]) {
  const rowH = Math.min(330000, (box.cy - 260000) / Math.max(rows.length, 1));
  let x = box.x;
  const xs = cols.map((c) => {
    const at = x;
    x += box.cx * c.w;
    return at;
  });
  cols.forEach((c, i) => w.text(xs[i], box.y, box.cx * c.w - 40000, 220000, run(c.label, { sz: 800, color: COLORS.faint, bold: true }), { algn: c.align ?? "l", wrap: "none" }));
  rows.forEach((r, ri) => {
    const y = box.y + 260000 + ri * rowH;
    if (ri % 2 === 0) w.rect(box.x - 40000, y - 15000, box.cx + 80000, rowH, "F7F7F5");
    r.forEach((cell, i) =>
      w.text(xs[i], y, box.cx * cols[i].w - 40000, rowH - 20000, run(cell, { sz: 950, color: i === 0 ? COLORS.ink : COLORS.muted, bold: i === 0 }), {
        algn: cols[i].align ?? "l",
        anchor: "ctr",
        wrap: "none",
      })
    );
  });
}

// ---- Customers & Revenue ------------------------------------------------------

export function customersRevenueSlide(ctx: InsightCtx, c: CustomerRevenue): ShapeWriter | null {
  if (!c.hasData) return null;
  const w = new ShapeWriter();
  const unit = c.valued ? "job value" : "jobs";
  w.header("Customers & Revenue", `Who ${ctx.customerName} served ${period(ctx.range)}  ·  ranked by ${unit}`);
  const repeatShare = c.customersServed ? c.repeatInPeriod / c.customersServed : 0;
  w.kpis(KPI_Y, [
    { value: fmtInt(c.customersServed), label: "Customers served this period" },
    { value: `${fmtInt(c.repeatInPeriod)} (${pct0(repeatShare)})`, label: "Came back for 2+ jobs" },
    { value: fmtInt(c.newServed), label: "New customers served" },
    { value: pct0(c.top5Share), label: `Share of ${unit} from top 5` },
    { value: c.totalReceivables > 0 ? fmtMoneyCompact(c.totalReceivables) : "$0", label: "Owed by customers (Zuper ledger)" },
  ]);

  const leftW = CONTENT_W * 0.55;
  const a = w.card(CONTENT_X, BODY_Y, leftW, BODY_H, `TOP CUSTOMERS THIS PERIOD — BY ${unit.toUpperCase()}`);
  w.chart(a.x, a.y, a.cx, a.cy, {
    kind: "bar",
    categories: c.topCustomers.map((t) => truncate(t.name, 26)),
    series: [{ name: c.valued ? "Job value" : "Jobs", values: c.topCustomers.map((t) => Math.round(c.valued ? t.value : t.jobs)), color: SERIES[0] }],
    ...(c.valued ? { numberFormat: "$#,##0" } : {}),
  });

  const rx = CONTENT_X + leftW + GAP;
  const rw = CONTENT_W - leftW - GAP;
  const b = w.card(rx, BODY_Y, rw, BODY_H, "WHO OWES THE MOST  ·  WHO WENT QUIET");
  let y = b.y;
  const maxOwed = c.receivables[0]?.amount ?? 0;
  if (c.receivables.length) {
    for (const r of c.receivables.slice(0, 3)) {
      w.barRow(b.x + 60000, y, b.cx - 120000, r.name, fmtMoneyCompact(r.amount), maxOwed ? r.amount / maxOwed : 0, { labelChars: 28 });
      y += 420000;
    }
  } else {
    w.text(b.x + 60000, y, b.cx - 120000, 300000, run("No open balances on the customer ledger.", { sz: 1000, color: COLORS.muted }));
    y += 360000;
  }
  y += 80000;
  w.text(b.x + 60000, y, b.cx - 120000, 240000, run("TOP-10 LIFETIME CUSTOMERS WITH NO JOBS THIS PERIOD", { sz: 800, color: COLORS.faint, bold: true }), { wrap: "none" });
  y += 280000;
  const quiet = c.quietHighValue.slice(0, 4);
  if (quiet.length)
    quiet.forEach((q) => {
      w.text(b.x + 60000, y, b.cx - 120000, 260000, run(truncate(q.name, 30), { sz: 1000, color: COLORS.ink, bold: true }) + run(`   ${fmtMoneyCompact(q.ltv)} lifetime · ${fmtInt(q.lifetimeJobs)} jobs`, { sz: 900, color: COLORS.muted }), { anchor: "ctr", wrap: "none" });
      y += 280000;
    });
  else w.text(b.x + 60000, y, b.cx - 120000, 300000, run("Every top-10 customer had work this period.", { sz: 1000, color: COLORS.muted }));

  const top = c.topCustomer;
  const owedTop = c.receivables[0];
  const quietValue = c.quietHighValue.reduce((s, q) => s + q.ltv, 0);
  w.keyCallouts(
    co([
      c.quietHighValue.length > 0 && {
        tone: "opportunity",
        headline: `${c.quietHighValue.length} of the 10 biggest lifetime customers had no jobs this period`,
        detail: `${names(c.quietHighValue)} — ${fmtMoneyCompact(quietValue)} of lifetime value between them.`,
        action: `Have the account owner call ${names(c.quietHighValue, 2)} this month with a check-in or maintenance offer.`,
        score: 66 + Math.min(10, c.quietHighValue.length * 2),
        area: "Customers",
      },
      top &&
        top.share >= 0.25 &&
        c.customersServed >= 5 && {
          tone: "risk",
          headline: `${top.name} alone is ${pct0(top.share)} of this period's ${unit}`,
          detail: `the top 5 customers make up ${pct0(c.top5Share)} — losing one would be felt immediately.`,
          action: `Protect ${top.name} with a service agreement, and grow the next tier of customers so no single account dominates.`,
          score: 60 + Math.min(12, (top.share - 0.25) * 40),
          area: "Customers",
        },
      repeatShare >= 0.4 &&
        c.customersServed >= 10 && {
          tone: "win",
          headline: `${pct0(repeatShare)} of customers came back for more than one job`,
          detail: `${fmtInt(c.repeatInPeriod)} of ${fmtInt(c.customersServed)} customers booked repeat work within the period.`,
          score: 52,
          area: "Customers",
        },
      repeatShare < 0.15 &&
        c.customersServed >= 30 && {
          tone: "opportunity",
          headline: `Only ${fmtInt(c.repeatInPeriod)} of ${fmtInt(c.customersServed)} customers booked a second job`,
          detail: `${pct0(repeatShare)} repeat rate this period — most relationships end after one visit.`,
          action: "Set up recurring jobs or service contracts in Zuper for the top one-time customers, and follow up after each completed job.",
          score: 56,
          area: "Customers",
        },
      owedTop &&
        owedTop.amount >= 5000 && {
          tone: "risk",
          headline: `${owedTop.name} owes ${fmtMoneyCompact(owedTop.amount)}`,
          detail: `${fmtMoneyCompact(c.totalReceivables)} is owed across ${c.receivables.length >= 5 ? "5+" : fmtInt(c.receivables.length)} customers on the Zuper ledger.`,
          action: `Send ${owedTop.name} a statement with a Zuper Pay link, and set an automated reminder for balances over 30 days.`,
          score: 55 + Math.min(15, owedTop.amount / 20000),
          area: "Collections",
        },
      c.newServed >= 5 && {
        tone: "win",
        headline: `${fmtInt(c.newServed)} new customers were served this period`,
        detail: `${pct0(c.newServed / c.customersServed)} of everyone served was new to ${ctx.customerName}.`,
        score: 44,
        area: "Customers",
      },
    ]),
    `${fmtInt(c.customersServed)} customers served this period.`
  );
  w.footer(`Source: Zuper Jobs (linked customer, non-cancelled, created in period) & Customer ledger (lifetime value, receivables) · ${ctx.syncLine}`);
  w.notes = {
    purpose: "Who the business serves: concentration, repeat business, money owed and valuable customers who went quiet.",
    talkingPoints: [
      c.quietHighValue.length ? `Ask about ${names(c.quietHighValue, 2)} — are they still customers, or did the work move elsewhere?` : "Every top lifetime customer had work this period — a sign of healthy relationships.",
      "Concentration matters at renewal: the more one customer dominates, the more fragile the revenue.",
    ],
    metrics: [
      { label: "Customers served", value: fmtInt(c.customersServed), definition: "Distinct end customers on non-cancelled jobs created in the period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Came back for 2+ jobs", value: fmtInt(c.repeatInPeriod), definition: "Customers with two or more jobs created in the period.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Top-5 share", value: pct0(c.top5Share), definition: `Top 5 customers' ${unit} ÷ all customers' ${unit} in the period.`, source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Owed by customers", value: fmtMoneyCompact(c.totalReceivables), definition: "Receivables on Zuper's own customer ledger, as of the last sync.", source: "Zuper Customers (accounts.receivables)", evidence: "Current state" },
    ],
    caveats: [c.valued ? "Job value is the value on the job record; it isn't invoiced or collected revenue." : "Jobs carry no value, so customers are ranked by job count.", ctx.syncLine],
  };
  return w;
}

// ---- Team Productivity --------------------------------------------------------

export function teamProductivitySlide(ctx: InsightCtx, t: TeamProductivity): ShapeWriter | null {
  if (!t.hasData) return null;
  const w = new ShapeWriter();
  w.header("Team Productivity", `Jobs created ${period(ctx.range)}  ·  completed work and clocked hours per person`);
  const working = t.people.filter((p) => p.assigned > 0);
  const tracked = t.people.filter((p) => p.hours >= 8 && p.completed > 0);
  const perHour = (p: { revenue: number; hours: number }) => (p.hours > 0 ? p.revenue / p.hours : 0);
  w.kpis(KPI_Y, [
    { value: fmtInt(working.length), label: "People with assigned jobs" },
    { value: fmtInt(t.totalCompleted), label: "Jobs completed" },
    { value: t.totalRevenue > 0 ? fmtMoneyCompact(t.totalRevenue) : "—", label: "Value of completed jobs" },
    { value: t.totalHours > 0 && t.totalRevenue > 0 ? fmtMoneyCompact(t.totalRevenue / t.totalHours) : "—", label: "Job value per clocked hour" },
    { value: fmtInt(t.dormantSeats.length), label: `Active users not logged in (of ${fmtInt(t.activeUsers)})` },
  ]);

  const leftW = CONTENT_W * 0.64;
  const a = w.card(CONTENT_X, BODY_Y, leftW, BODY_H, "WHO DELIVERED THE WORK (TOP 8)");
  const showHours = t.totalHours > 0;
  table(
    w,
    { x: a.x + 60000, y: a.y, cx: a.cx - 120000, cy: a.cy },
    [
      { label: "PERSON", w: 0.34 },
      { label: "ASSIGNED", w: 0.12, align: "r" },
      { label: "COMPLETED", w: 0.14, align: "r" },
      { label: "JOB VALUE", w: 0.15, align: "r" },
      { label: showHours ? "HOURS" : "", w: 0.11, align: "r" },
      { label: showHours ? "$ / HOUR" : "", w: 0.14, align: "r" },
    ],
    t.people.slice(0, 8).map((p) => [
      truncate(p.name, 26),
      fmtInt(p.assigned),
      fmtInt(p.completed),
      p.revenue > 0 ? fmtMoneyCompact(p.revenue) : "—",
      showHours ? (p.hours > 0 ? fmtInt(p.hours) : "—") : "",
      showHours ? (p.hours >= 8 && p.revenue > 0 ? fmtMoneyCompact(perHour(p)) : "—") : "",
    ])
  );

  const rx = CONTENT_X + leftW + GAP;
  const b = w.card(rx, BODY_Y, CONTENT_W - leftW - GAP, BODY_H, "PAID SEATS NOT IN USE");
  if (t.dormantSeats.length) {
    let y = b.y;
    w.text(b.x + 60000, y, b.cx - 120000, 400000, run(`No login since ${fmtDate(ctx.range.start)}:`, { sz: 950, color: COLORS.muted }));
    y += 360000;
    for (const d of t.dormantSeats.slice(0, 7)) {
      w.text(b.x + 60000, y, b.cx - 120000, 260000, run(truncate(d.name, 24), { sz: 1000, color: COLORS.ink, bold: true }) + run(`  ${d.licenseType ? d.licenseType.toLowerCase() : ""}${d.lastLoginAt ? ` · last ${fmtDate(d.lastLoginAt)}` : " · never"}`, { sz: 850, color: COLORS.muted }), { anchor: "ctr", wrap: "none" });
      y += 300000;
    }
    if (t.dormantSeats.length > 7) w.text(b.x + 60000, y, b.cx - 120000, 260000, run(`+ ${fmtInt(t.dormantSeats.length - 7)} more`, { sz: 900, color: COLORS.muted }));
  } else w.empty(b, `All ${fmtInt(t.activeUsers)} active users logged in during the period.`);

  const top = [...working].sort((x, y) => y.revenue - x.revenue || y.completed - x.completed)[0];
  const topShare = top && t.totalRevenue ? top.revenue / t.totalRevenue : 0;
  const rated = [...tracked].sort((x, y) => perHour(y) - perHour(x));
  const best = rated[0];
  const low = rated[rated.length - 1];
  w.keyCallouts(
    co([
      t.dormantSeats.length > 0 && {
        tone: t.dormantSeats.length >= 3 ? "risk" : "watch",
        headline: `${fmtInt(t.dormantSeats.length)} active ${t.dormantSeats.length === 1 ? "user hasn't" : "users haven't"} logged in since ${fmtDate(ctx.range.start)}`,
        detail: `${names(t.dormantSeats)} — paid seats that aren't being used.`,
        action: "Confirm with the admin whether these seats are still needed; retrain or reassign them before renewal.",
        score: 52 + Math.min(18, t.dormantSeats.length * 3),
        area: "Seats",
      },
      top &&
        topShare >= 0.4 &&
        working.length >= 3 && {
          tone: "risk",
          headline: `${top.name} delivered ${pct0(topShare)} of all completed job value`,
          detail: `${fmtInt(top.completed)} jobs worth ${fmtMoneyCompact(top.revenue)} — the business leans heavily on one person.`,
          action: `Document ${top.name}'s job types as checklists in Zuper and route similar work to others to spread the load.`,
          score: 58,
          area: "Team",
        },
      top &&
        top.revenue > 0 &&
        topShare < 0.4 && {
          tone: "win",
          headline: `${top.name} led the team: ${fmtInt(top.completed)} jobs, ${fmtMoneyCompact(top.revenue)} completed`,
          detail: `${pct0(topShare)} of the team's completed job value.`,
          score: 40,
          area: "Team",
        },
      best &&
        low &&
        best !== low &&
        perHour(best) >= perHour(low) * 1.8 && {
          tone: "opportunity",
          headline: `Job value per hour ranges from ${fmtMoneyCompact(perHour(low))} (${low.name}) to ${fmtMoneyCompact(perHour(best))} (${best.name})`,
          detail: `among ${fmtInt(rated.length)} people with clocked hours — a sizeable gap in output per hour.`,
          action: `Review ${low.name}'s job mix and travel; pair them with ${best.name} on similar work.`,
          score: 50,
          area: "Team",
        },
    ]),
    `${fmtInt(working.length)} people completed ${fmtInt(t.totalCompleted)} jobs this period.`
  );
  w.footer(`Source: Zuper Jobs (primary assignee, created in period), Timesheets (paired clock-in/out) & Teams (last login) · ${ctx.syncLine}`);
  w.notes = {
    purpose: "Who delivers the work and how productive the paid seats are.",
    talkingPoints: [
      t.dormantSeats.length ? `${fmtInt(t.dormantSeats.length)} seats haven't been used this period — raise it before renewal, not at renewal.` : "Every active seat is in use.",
      "Job value per hour only counts people with 8+ clocked hours and completed jobs.",
    ],
    metrics: [
      { label: "Value of completed jobs", value: fmtMoneyCompact(t.totalRevenue), definition: "Job value of jobs created in the period and now completed, by primary assignee.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Clocked hours", value: fmtInt(t.totalHours), definition: "Paired CHECK_IN → CHECK_OUT timesheet events in the period (shifts over 24 h ignored).", source: "Zuper Timesheets", evidence: t.totalHours ? "Observed activity" : "Insufficient data" },
      { label: "Not logged in", value: fmtInt(t.dormantSeats.length), definition: "Active users whose last login is before the period start, or who never logged in.", source: "Zuper Teams (last_login_at)", evidence: "Current state" },
    ],
    caveats: ["Only the primary assignee is credited; helpers on multi-person jobs aren't counted.", ctx.syncLine],
  };
  return w;
}

// ---- Speed & Efficiency ---------------------------------------------------------

const SPEED_ACTION: Record<SpeedMetric["key"], string> = {
  job_to_scheduled: "Use dispatch board auto-assign or a workflow that alerts the dispatcher when a job sits unscheduled for 24 h.",
  scheduled_to_done: "Look at which job types run long and add checklists or parts prep before the visit.",
  job_to_done: "Find the status where jobs wait longest (see Job Lifecycle) and put a follow-up workflow on it.",
  quote_to_sent: "Use proposal templates so quotes go out the same day the estimate is done.",
  quote_to_accepted: "Turn on automated quote follow-up reminders at day 3 and day 7.",
  invoice_to_paid: "Send invoices with a Zuper Pay link and switch on automatic payment reminders.",
};

export function speedSlide(ctx: InsightCtx, s: SpeedEfficiency): ShapeWriter | null {
  if (!s.hasData) return null;
  const w = new ShapeWriter();
  w.header("Speed & Efficiency", `Median time for work finished ${period(ctx.range)}  ·  vs ${period(s.prior)}`);
  w.kpis(KPI_Y, s.metrics.slice(0, 5).map((m) => ({ value: days(m.now), label: m.label })));

  const a = w.card(CONTENT_X, BODY_Y, CONTENT_W, BODY_H, "THIS PERIOD VS THE PERIOD BEFORE  ·  LOWER IS BETTER");
  const rows = s.metrics.slice(0, 6);
  const rowH = Math.min(520000, a.cy / rows.length);
  rows.forEach((m, i) => {
    const y = a.y + 40000 + i * rowH;
    if (m.before != null && m.now != null) {
      const diff = m.before - m.now;
      w.dumbbell(a.x + 60000, y, a.cx - 120000, {
        label: m.label,
        before: m.before,
        after: m.now,
        beforeText: `${days(m.before)} before`,
        afterText: days(m.now),
        improved: diff >= 0,
        delta: diff === 0 ? "no change" : `${days(Math.abs(diff))} ${diff > 0 ? "faster" : "slower"}`,
      });
    } else {
      w.text(a.x + 60000, y, (a.cx - 120000) * 0.3, 360000, run(m.label, { sz: 1050, color: COLORS.ink, bold: true }), { anchor: "ctr" });
      w.text(a.x + 60000 + (a.cx - 120000) * 0.32, y, (a.cx - 120000) * 0.66, 360000, run(`${days(m.now)} this period  ·  not enough activity the period before to compare`, { sz: 950, color: COLORS.muted }), { anchor: "ctr", wrap: "none" });
    }
  });

  const compared = s.metrics.filter((m) => m.now != null && m.before != null && m.before > 0);
  const change = (m: SpeedMetric) => (m.before! - m.now!) / m.before!;
  const gains = compared.filter((m) => change(m) >= 0.15 && m.before! - m.now! >= 0.5).sort((x, y) => change(y) - change(x));
  const losses = compared.filter((m) => change(m) <= -0.15 && m.now! - m.before! >= 0.5).sort((x, y) => change(x) - change(y));
  const get = (k: SpeedMetric["key"]) => s.metrics.find((m) => m.key === k);
  const pay = get("invoice_to_paid");
  const accept = get("quote_to_accepted");
  const sched = get("job_to_scheduled");
  w.keyCallouts(
    co([
      gains[0] && {
        tone: "win",
        headline: `${gains[0].label} is ${pct0(change(gains[0]))} faster: ${days(gains[0].now)} vs ${days(gains[0].before)}`,
        detail: `median over ${fmtInt(gains[0].nowSample)} this period against ${fmtInt(gains[0].beforeSample)} the period before.`,
        score: 55 + Math.min(15, change(gains[0]) * 30),
        area: "Speed",
      },
      gains[1] && {
        tone: "win",
        headline: `${gains[1].label} improved to ${days(gains[1].now)} (from ${days(gains[1].before)})`,
        detail: `${pct0(change(gains[1]))} faster than the period before.`,
        score: 45,
        area: "Speed",
      },
      losses[0] && {
        tone: "risk",
        headline: `${losses[0].label} slowed to ${days(losses[0].now)} (from ${days(losses[0].before)})`,
        detail: `${pct0(-change(losses[0]))} slower than the period before, across ${fmtInt(losses[0].nowSample)} items.`,
        action: SPEED_ACTION[losses[0].key],
        score: 58 + Math.min(12, -change(losses[0]) * 20),
        area: "Speed",
      },
      pay?.now != null &&
        pay.now > 30 && {
          tone: "risk",
          headline: `Invoices take ${days(pay.now)} to get paid (median)`,
          detail: `over a month of cash tied up per invoice, across ${fmtInt(pay.nowSample)} invoices paid this period.`,
          action: SPEED_ACTION.invoice_to_paid,
          score: 62,
          area: "Collections",
        },
      accept?.now != null &&
        accept.now > 14 && {
          tone: "opportunity",
          headline: `Quotes take ${days(accept.now)} to be accepted (median)`,
          detail: `the longer a quote waits, the less likely it closes — ${fmtInt(accept.nowSample)} accepted this period.`,
          action: SPEED_ACTION.quote_to_accepted,
          score: 54,
          area: "Quotes",
        },
      sched?.now != null &&
        sched.now > 3 && {
          tone: "opportunity",
          headline: `New jobs wait ${days(sched.now)} to be scheduled (median)`,
          detail: `across ${fmtInt(sched.nowSample)} jobs — customers notice when nobody books them in.`,
          action: SPEED_ACTION.job_to_scheduled,
          score: 52,
          area: "Speed",
        },
    ]),
    "How quickly work moves from request to cash."
  );
  w.footer(`Source: Zuper Jobs (status history), Quotes (sent/accepted dates), Invoices (issued/paid dates) · medians, 5+ items each · ${ctx.syncLine}`);
  w.notes = {
    purpose: "How fast work moves from request to schedule, to done, and from quote and invoice to money — and whether it's getting faster.",
    talkingPoints: ["Lead with what got faster; then pick the one slowdown worth fixing.", "Each figure is a median, so a few unusual jobs don't skew it."],
    metrics: s.metrics.map((m) => ({
      label: m.label,
      value: `${days(m.now)}${m.before != null ? ` (was ${days(m.before)})` : ""}`,
      definition: "Median days, dated by when the step finished; only shown with 5+ items in the period.",
      source: m.key.startsWith("quote") ? "Zuper Quotes" : m.key.startsWith("invoice") ? "Zuper Invoices" : "Zuper Jobs (status history)",
      evidence: "Observed activity",
    })),
    caveats: ["Scheduled time is when the job first reached a Scheduled (or later) status in Zuper.", ctx.syncLine],
  };
  return w;
}

// ---- What We've Built Together -------------------------------------------------------

export interface Capability {
  title: string;
  /** Up to 3 short proof points, each carrying the account's own figure. */
  points: string[];
}

/** The Zuper capabilities this account actually runs on, with proof from its data (up to 6, in the order given). */
export function builtTogetherSlide(ctx: InsightCtx, caps: Capability[], monthsOnZuper: number): ShapeWriter | null {
  const shown = caps.filter((c) => c.points.length).slice(0, 6);
  if (shown.length < 2) return null;
  const w = new ShapeWriter();
  w.header("What We've Built Together", `What ${ctx.customerName} runs on Zuper today${monthsOnZuper ? `  ·  ${monthsOnZuper} months of partnership` : ""}`);
  const cols = 3;
  const gap = 150000;
  const cw = (CONTENT_W - gap * (cols - 1)) / cols;
  const rowsN = Math.ceil(shown.length / cols);
  const ch = Math.min(2350000, (4950000 - (rowsN - 1) * gap) / rowsN);
  shown.forEach((c, i) => {
    const x = CONTENT_X + (i % cols) * (cw + gap);
    const y = 1300000 + Math.floor(i / cols) * (ch + gap);
    w.rect(x, y, cw, ch, COLORS.white, { radius: 5000, border: COLORS.border });
    w.rect(x, y, 70000, ch, COLORS.orange);
    w.text(x + 220000, y + 160000, cw - 380000, 300000, run(c.title.toUpperCase(), { sz: 1150, color: COLORS.orange, bold: true }), { wrap: "none" });
    c.points.slice(0, 3).forEach((p, k) => {
      const py = y + 560000 + k * 520000;
      w.rect(x + 230000, py + 80000, 70000, 70000, COLORS.orange, { radius: 50000 });
      w.text(x + 380000, py, cw - 560000, 480000, run(truncate(p, 90), { sz: 1050, color: COLORS.ink }));
    });
  });
  w.footer(`Source: ${ctx.customerName}'s Zuper records — totals since go-live, configuration as of the last sync · ${ctx.syncLine}`);
  w.notes = {
    purpose: "What the partnership has put in place: every capability shown is one the account actively uses, with its own numbers.",
    talkingPoints: [
      "Walk the cards as achievements the two teams built together; pause on the one the customer values most.",
      "Anything not shown here isn't in use yet — those are on the improvement and priorities slides.",
    ],
    callouts: shown.map((c) => `${c.title}: ${c.points.join("; ")}`),
    caveats: [ctx.syncLine],
  };
  return w;
}

// ---- Scaling Together -----------------------------------------------------------------

export interface GrowthYear {
  label: string;
  jobs: number;
  completed: number;
  invoiced: number;
  customersAdded: number;
  /** The year isn't over (or the account started mid-year). */
  partial: boolean;
}

export function scalingSlide(ctx: InsightCtx, years: GrowthYear[], industryLabel: string, usesInvoices: boolean): ShapeWriter | null {
  const shown = years.filter((y) => y.jobs > 0).slice(-4);
  if (!shown.length) return null;
  const w = new ShapeWriter();
  const firstFull = shown.find((y) => !y.partial);
  const lastFull = [...shown].reverse().find((y) => !y.partial);
  w.header(
    `Scaling Together: ${truncate(ctx.customerName, 40)} on Zuper`,
    firstFull && lastFull && firstFull !== lastFull
      ? `Jobs per year grew from ${fmtInt(firstFull.jobs)} (${firstFull.label}) to ${fmtInt(lastFull.jobs)} (${lastFull.label})`
      : `Jobs, billing and new customers each year on Zuper  ·  ${fmtInt(shown.reduce((s, y) => s + y.jobs, 0))} jobs so far`
  );

  // Left: the partnership framework, tied to this account's trade.
  const leftW = CONTENT_W * 0.36;
  const trade = industryLabel.toLowerCase();
  const framework: [string, string][] = [
    ["ENTERPRISE READINESS", "Proven with field-service teams from single crews to multi-region operations, on one platform."],
    ["STRATEGY ALIGNMENT", `Zuper's ${trade} focus matches ${ctx.customerName}'s growth plans — the product roadmap is built for this trade.`],
    ["INNOVATION TRACK RECORD", "AI agents for the field, the front desk and collections, built into the same system the team already uses."],
  ];
  const fh = (4450000 - 2 * GAP) / 3;
  framework.forEach(([title, body], i) => {
    const y = 1300000 + i * (fh + GAP);
    w.rect(CONTENT_X, y, leftW, fh, COLORS.white, { radius: 6000, border: COLORS.border });
    w.text(CONTENT_X + 180000, y + 140000, leftW - 360000, 240000, run(title, { sz: 1000, color: COLORS.orange, bold: true }), { wrap: "none" });
    w.text(CONTENT_X + 180000, y + 430000, leftW - 360000, fh - 520000, run(body, { sz: 1050, color: COLORS.ink }));
  });

  // Right: year-by-year growth from the account's own records.
  const rx = CONTENT_X + leftW + GAP;
  const rw = CONTENT_W - leftW - GAP;
  const a = w.card(rx, 1300000, rw, 4450000, "GROWTH ON ZUPER, YEAR BY YEAR");
  w.chart(a.x, a.y, a.cx, 2000000, {
    kind: "column",
    categories: shown.map((y) => y.label),
    series: [
      { name: "Jobs created", values: shown.map((y) => y.jobs), color: SERIES[0] },
      { name: "Jobs completed", values: shown.map((y) => y.completed), color: SERIES[1] },
    ],
  });
  table(
    w,
    { x: a.x + 60000, y: a.y + 2150000, cx: a.cx - 120000, cy: a.cy - 2150000 },
    [
      { label: "YEAR", w: 0.28 },
      { label: "JOBS", w: 0.18, align: "r" },
      { label: usesInvoices ? "INVOICED" : "COMPLETED", w: 0.27, align: "r" },
      { label: "NEW CUSTOMERS", w: 0.27, align: "r" },
    ],
    shown.map((y) => [y.label, fmtInt(y.jobs), usesInvoices ? fmtMoneyCompact(y.invoiced) : fmtInt(y.completed), fmtInt(y.customersAdded)])
  );

  const growth = firstFull && lastFull && firstFull !== lastFull && firstFull.jobs ? lastFull.jobs / firstFull.jobs - 1 : null;
  w.keyCallouts(
    co([
      growth != null &&
        growth >= 0.1 && {
          tone: "win",
          headline: `Job volume on Zuper is up ${pct0(growth)} from ${firstFull!.label} to ${lastFull!.label}`,
          detail: `${fmtInt(firstFull!.jobs)} → ${fmtInt(lastFull!.jobs)} jobs a year, run through the same platform.`,
          score: 56 + Math.min(14, growth * 10),
          area: "Growth",
        },
    ]),
    `${fmtInt(shown.reduce((s, y) => s + y.jobs, 0))} jobs run through Zuper across ${shown.length} year${shown.length === 1 ? "" : "s"}.`
  );
  w.footer(`Source: ${ctx.customerName}'s Zuper Jobs, Invoices & Customers by calendar year · YTD = year still in progress · ${ctx.syncLine}`);
  w.notes = {
    purpose: "Where the partnership has taken the business so far, and why Zuper is the platform to scale on next.",
    talkingPoints: ["Let the yearly numbers make the growth case; then link the framework to the priorities agreed on the next slides."],
    caveats: ["A partial year (YTD) isn't comparable with a full year.", ctx.syncLine],
  };
  return w;
}

// ---- What Could Be Done Better ------------------------------------------------------

/** Customer-facing wording: a risk on this page is something to fix, not an accusation. */
const IMPROVEMENT_LABEL: Record<Callout["tone"], string> = { win: "WIN", risk: "FIX", watch: "WATCH", opportunity: "OPPORTUNITY" };

/** Areas that describe data coverage or setup rather than how the business runs. */
const NOT_IMPROVEMENTS = new Set(["Coverage", "Setup", "Data coverage"]);

/** The account's most material problems and openings, at most 2 per area; ones with a next step first. */
export function improvementPicks(all: Callout[], n = 6): Callout[] {
  const pool = all.filter((c) => c.tone !== "win" && c.score >= 40 && !NOT_IMPROVEMENTS.has(c.area));
  return topAcross(
    pool.map((c) => ({ ...c, score: c.score + (c.action ? 3 : 0) })),
    n,
    2
  );
}

export function improvementsSlide(customerName: string, all: Callout[]): ShapeWriter | null {
  const picked = improvementPicks(all);
  if (picked.length < 2) return null;
  const w = new ShapeWriter();
  w.header("What Could Be Done Better", `The ${picked.length} biggest improvements we see in ${customerName}'s account — what we saw, and what to do`);
  const cols = 2;
  const gap = 150000;
  const cw = (CONTENT_W - gap) / cols;
  const rowsN = Math.ceil(picked.length / cols);
  const ch = Math.min(1500000, (5150000 - (rowsN - 1) * 120000) / rowsN);
  picked.forEach((c, i) => {
    const x = CONTENT_X + (i % cols) * (cw + gap);
    const y = 1300000 + Math.floor(i / cols) * (ch + 120000);
    w.rect(x, y, cw, ch, COLORS.white, { radius: 5000, border: COLORS.border });
    w.rect(x + 150000, y + 140000, 320000, 320000, COLORS.orange, { radius: 50000 });
    w.text(x + 150000, y + 140000, 320000, 320000, run(String(i + 1), { sz: 1200, color: COLORS.white, bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
    w.text(x + 560000, y + 150000, cw - 720000, 300000, run(`${c.area.toUpperCase()}  ·  ${IMPROVEMENT_LABEL[c.tone]}`, { sz: 800, color: COLORS.faint, bold: true }), { anchor: "ctr", wrap: "none" });
    w.text(x + 560000, y + 440000, cw - 720000, 360000, run(truncate(c.headline, 95), { sz: 1100, color: COLORS.ink, bold: true }));
    // What we saw: the finding's own numbers, one line.
    if (c.action) w.text(x + 560000, y + 800000, cw - 720000, 230000, run(truncate(c.detail.replace(/^./, (s) => s.toUpperCase()), 92), { sz: 880, color: COLORS.muted }), { wrap: "none" });
    const next = c.action ?? c.detail.replace(/^./, (s) => s.toUpperCase());
    w.text(x + 560000, y + (c.action ? 1060000 : 820000), cw - 720000, ch - (c.action ? 1100000 : 860000), run("What to do: ", { sz: 920, color: COLORS.orange, bold: true }) + run(truncate(next, 160), { sz: 920, color: COLORS.ink }));
  });
  w.footer("Ranked by materiality across every slide in this deck · each item's numbers are on its own slide and in the speaker notes");
  w.notes = {
    purpose: "The improvement agenda: the most material problems and openings in the account, each with a concrete next step.",
    callouts: picked.map((c) => `${c.area}: ${c.headline} — ${c.action ?? c.detail}`),
    talkingPoints: [
      "Frame these as where Zuper can help next, not as criticism.",
      "Agree an owner and a date for the top two before moving on to priorities.",
    ],
    caveats: ["Ranking is by a fixed materiality score (money at stake, share of work affected), not by AI."],
  };
  return w;
}
