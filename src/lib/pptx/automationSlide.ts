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
    { value: s.needsAttention, label: "Flagged as needing attention", alert: s.needsAttention > 0 },
  ];
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
    const detailRuns =
      run(truncate(detail, 52), { sz: 850, color: COLORS.muted }) +
      (wf.needsAttention ? run("  ·  needs attention", { sz: 850, color: COLORS.alert, bold: true }) : "");
    w.text(innerX, y + 230000, innerW, 200000, detailRuns, { wrap: "none" });
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
  if (s.needsAttention > 0) parts.push(`${plural(s.needsAttention, "workflow")} ${s.needsAttention === 1 ? "needs" : "need"} attention`);
  if (s.drafts > 0) parts.push(`${fmtInt(s.drafts)} more ${s.drafts === 1 ? "is" : "are"} still in draft`);
  return `${parts.join("; ")}.`;
}

export async function insertAutomationSlide(zip: JSZip, s: WorkflowSummary, customerName: string, periodLabel: string): Promise<void> {
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
  w.insight(automationInsight(s));
  await insertGeneratedSlide(zip, INSERT_AFTER, w);
}
