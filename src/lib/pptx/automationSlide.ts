import type JSZip from "jszip";
import { PLUMBING_CATEGORIES, type WorkflowSummary } from "@/lib/reports/ebrMetrics";
import { CARD_W, CARD_XS, COLORS, CONTENT_W, CONTENT_X, ShapeWriter, fmtInt, insertGeneratedSlide, run, truncate } from "./generatedSlide";

// "How {customer} Automates Manual Work" — generated per export and spliced in
// right after Platform Performance (slide21). Everything here comes from
// Workflow Builder definitions (see prisma Workflow comment): the API exposes
// no execution counts or API-call volume, so this slide shows what is
// automated and how, never invented run totals.

const INSERT_AFTER = "ppt/slides/slide21.xml";

const KPI_Y = 1350000;
const KPI_H = 900000;
const KPI_GAP = 150000;
const CARD_Y = 2400000;
const CARD_H = 3350000;
const PAD = 200000;

function plural(n: number, word: string): string {
  return `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;
}

/** Manual-work categories ranked first; code/branching/lookup steps folded into one trailing row. */
function workRows(s: WorkflowSummary): { label: string; value: string; n: number }[] {
  const work = s.categories.filter((c) => !PLUMBING_CATEGORIES.includes(c.key));
  const plumbingSteps = s.categories.filter((c) => PLUMBING_CATEGORIES.includes(c.key)).reduce((sum, c) => sum + c.steps, 0);
  const rows = work.map((c) => ({ label: c.label, value: plural(c.steps, "step"), n: c.steps }));
  if (plumbingSteps > 0) rows.push({ label: "Behind-the-scenes logic", value: plural(plumbingSteps, "step"), n: plumbingSteps });
  return rows;
}

function fmtShortDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function drawKpis(w: ShapeWriter, s: WorkflowSummary) {
  const tiles: { value: number; label: string; alert?: boolean }[] = [
    { value: s.total, label: "Workflows present" },
    { value: s.live, label: "Live (active & published)" },
    { value: s.ranInPeriod, label: "Live workflows that ran this period" },
    { value: s.liveSteps, label: "Automated steps in live workflows" },
    // Slides show positive data; workflows needing attention are a risk call-out on the reference slide.
    { value: s.workflows.length, label: "Workflows built in Zuper" },
  ] as { value: number; label: string; alert?: boolean }[];
  const tileW = (CONTENT_W - KPI_GAP * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = CONTENT_X + i * (tileW + KPI_GAP);
    w.rect(x, KPI_Y, tileW, KPI_H, COLORS.white, { radius: 10000, border: COLORS.border });
    w.text(x, KPI_Y + 120000, tileW, 420000, run(fmtInt(t.value), { sz: 2400, color: t.alert ? COLORS.alert : COLORS.orange, bold: true }), {
      algn: "ctr",
      anchor: "ctr",
      wrap: "none",
    });
    w.text(x + 100000, KPI_Y + 560000, tileW - 200000, 280000, run(t.label, { sz: 950, color: COLORS.muted }), { algn: "ctr" });
  });
}

function drawCardFrame(w: ShapeWriter, x: number, title: string) {
  w.rect(x, CARD_Y, CARD_W, CARD_H, COLORS.white, { radius: 6000, border: COLORS.border });
  w.text(x + PAD, CARD_Y + 180000, CARD_W - 2 * PAD, 260000, run(title, { sz: 1200, color: COLORS.orange, bold: true }));
}

function drawEmpty(w: ShapeWriter, x: number, message: string) {
  w.text(x + PAD, CARD_Y + 1200000, CARD_W - 2 * PAD, 600000, run(message, { sz: 1100, color: COLORS.faint }), { algn: "ctr" });
}

function drawBarCard(w: ShapeWriter, x: number, title: string, rows: { label: string; value: string; n: number }[], empty: string) {
  drawCardFrame(w, x, title);
  if (rows.length === 0) return drawEmpty(w, x, empty);
  const max = Math.max(...rows.map((r) => r.n), 1);
  rows.slice(0, 5).forEach((r, i) => {
    w.barRow(x + PAD, CARD_Y + 560000 + i * 540000, CARD_W - 2 * PAD, r.label, r.value, r.n / max, { labelChars: 24 });
  });
}

function drawWorkflowList(w: ShapeWriter, x: number, s: WorkflowSummary) {
  const liveRows = s.workflows.filter((wf) => wf.isLive);
  const rows = liveRows.length ? liveRows : s.workflows;
  drawCardFrame(w, x, liveRows.length ? "LIVE WORKFLOWS" : "WORKFLOWS (NONE LIVE YET)");
  if (rows.length === 0) return drawEmpty(w, x, "No workflows have been built yet");

  const innerX = x + PAD;
  const innerW = CARD_W - 2 * PAD;
  const shown = rows.slice(0, 5);
  shown.forEach((wf, i) => {
    const y = CARD_Y + 560000 + i * 500000;
    w.text(innerX, y, innerW, 220000, run(truncate(wf.name, 36), { sz: 1050, color: COLORS.ink, bold: true }), { wrap: "none" });
    const detail = [
      wf.triggerName ?? "No trigger",
      plural(wf.stepCount, "step"),
      wf.lastExecutionTime ? `last run ${fmtShortDate(wf.lastExecutionTime)}` : "never run",
    ].join("  ·  ");
    w.text(innerX, y + 230000, innerW, 200000, run(truncate(detail, 52), { sz: 850, color: COLORS.muted }), { wrap: "none" });
  });
  if (rows.length > shown.length) {
    w.text(innerX, CARD_Y + CARD_H - 230000, innerW, 180000, run(`+ ${fmtInt(rows.length - shown.length)} more`, { sz: 850, color: COLORS.faint }));
  }
}

/** Deterministic talking point — every number is read straight off the summary. */
export function automationInsight(s: WorkflowSummary): string {
  if (s.total === 0) {
    return "No Workflow Builder automations are configured yet, so status updates, customer emails and hand-offs to other systems are still done by hand.";
  }
  if (s.live === 0) {
    return `${plural(s.total, "workflow")} ${s.total === 1 ? "has" : "have"} been built but none are live yet — publishing and activating them is the quickest way to take manual steps off the team.`;
  }
  const parts = [`${plural(s.live, "live workflow")} automate ${plural(s.liveSteps, "step")}`];
  const topWork = s.categories.find((c) => !PLUMBING_CATEGORIES.includes(c.key));
  if (topWork) parts[0] += `, led by ${topWork.label.toLowerCase()} (${plural(topWork.steps, "step")})`;
  const topTrigger = s.triggers[0];
  if (topTrigger) parts.push(`the most common starting point is "${topTrigger.name}" (${plural(topTrigger.count, "workflow")})`);
  if (s.webhookTriggered > 0) parts.push(`${plural(s.webhookTriggered, "workflow")} ${s.webhookTriggered === 1 ? "is" : "are"} triggered by other systems via webhook`);
  // Workflows needing attention are left to the risk call-out (closing reference slide), not this slide line.
  if (s.drafts > 0) parts.push(`${fmtInt(s.drafts)} more ${s.drafts === 1 ? "is" : "are"} still in draft`);
  return `${parts.join("; ")}.`;
}

export async function insertAutomationSlide(zip: JSZip, s: WorkflowSummary, customerName: string, periodLabel: string): Promise<string> {
  const w = new ShapeWriter();
  w.header(`How ${customerName} Automates Manual Work`, `${periodLabel}  ·  Workflow Builder automations`);
  drawKpis(w, s);
  drawBarCard(
    w,
    CARD_XS[0],
    "WHAT STARTS THEM",
    s.triggers.map((t) => ({ label: t.name, value: plural(t.count, "workflow"), n: t.count })),
    "No live workflows"
  );
  drawBarCard(w, CARD_XS[1], "WHAT GETS AUTOMATED", workRows(s), "No live workflows");
  drawWorkflowList(w, CARD_XS[2], s);
  const liveNotRun = s.live - s.ranInPeriod;
  w.keyCallouts(
    [
      ...(s.needsAttention > 0
        ? [{ tone: "risk" as const, headline: `${plural(s.needsAttention, "workflow")} flagged by Workflow Builder as needing attention`, detail: `${s.workflows.filter((x) => x.needsAttention).slice(0, 2).map((x) => `"${truncate(x.name, 30)}"`).join(", ")} — a broken automation quietly pushes work back onto the team.`, score: 62, area: "Automation" }]
        : []),
      ...(s.live > 0 && liveNotRun / s.live >= 0.5
        ? [{ tone: "watch" as const, headline: `${fmtInt(liveNotRun)} of ${fmtInt(s.live)} live workflows didn't run this period`, detail: "their triggers never fired — retire them or check the trigger conditions.", score: 44, area: "Automation" }]
        : []),
      ...(s.drafts > 0
        ? [{ tone: "watch" as const, headline: `${plural(s.drafts, "workflow")} still in draft`, detail: "built but never published — finish or delete.", score: 30, area: "Automation" }]
        : []),
      ...(s.total === 0
        ? [{ tone: "opportunity" as const, headline: "No Workflow Builder automations yet", detail: "status updates, customer emails and hand-offs are still done by hand.", score: 55, area: "Automation" }]
        : []),
      ...(s.webhookTriggered > 0
        ? [{ tone: "win" as const, headline: `${plural(s.webhookTriggered, "workflow")} triggered by other systems`, detail: "Zuper is connected into the wider stack via webhooks.", score: 32, area: "Automation" }]
        : []),
    ],
    automationInsight(s)
  );
  w.footer('Source: Zuper Workflow Builder definitions (current configuration) · "ran this period" = most recent run falls in the period · run counts on the next slide');
  const topWork = s.categories.find((c) => !PLUMBING_CATEGORIES.includes(c.key));
  w.notes = {
    purpose: `What ${customerName} has automated with Workflow Builder: what starts each automation and what kind of manual work it replaces.`,
    callouts: [
      automationInsight(s),
      ...(s.drafts > 0 ? [`${plural(s.drafts, "workflow")} ${s.drafts === 1 ? "is" : "are"} still in draft and never run — ask whether they should be finished or deleted.`] : []),
      ...(s.needsAttention > 0 ? [`${plural(s.needsAttention, "workflow")} flagged as needing attention: ${s.workflows.filter((w) => w.needsAttention).slice(0, 4).map((w) => w.name).join("; ")}.`] : []),
      ...(topWork ? [`Biggest category of automated work: ${topWork.label.toLowerCase()} (${plural(topWork.steps, "step")} across ${plural(topWork.workflows, "workflow")}).`] : []),
    ],
    metrics: [
      { label: "Workflows present", value: fmtInt(s.total), definition: "All workflows in Workflow Builder, any state.", source: "Zuper Workflow Builder", evidence: "Configuration" },
      { label: "Live", value: fmtInt(s.live), definition: "Active and published — the only workflows that run.", source: "Zuper Workflow Builder", evidence: "Configuration" },
      { label: "Ran this period", value: fmtInt(s.ranInPeriod), definition: "Live workflows whose most recent run falls in the period (a floor on activity, not a run count).", source: "Zuper Workflow Builder", evidence: "Observed activity" },
      { label: "Automated steps", value: fmtInt(s.liveSteps), definition: "Action steps (excluding the trigger) across live workflows.", source: "Zuper Workflow Builder (published nodes)", evidence: "Configuration" },
      { label: "What gets automated", definition: "Each action step bucketed by its action type: emails/notifications, record updates, records created, external calls; lookups, branching and code are grouped as behind-the-scenes logic.", source: "Zuper Workflow Builder", evidence: "Configuration" },
    ],
    caveats: ["A configured step shows what's automated, not how much time it saves — time savings need a measured before/after baseline."],
  };
  return insertGeneratedSlide(zip, INSERT_AFTER, w);
}
