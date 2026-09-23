import type JSZip from "jszip";
import type { LineItemTypeUsage, LineItemUsage } from "@/lib/analytics";
import { CARD_W, CARD_XS, COLORS, ShapeWriter, fmtInt, fmtMoneyCompact, insertGeneratedSlide, run } from "./generatedSlide";

// "Parts, Products & Services Usage" slide — generated per export (not in the
// template) and spliced in after the last Key Metrics slide.

/** Last slide of the "Business Performance, Key Metrics" section. */
const INSERT_AFTER = "ppt/slides/slide19.xml";

const CARD_Y = 1413547;
const CARD_H = 4350000;
const PAD = 200000;
const ROW_STEP = 500000;

function drawCard(w: ShapeWriter, x: number, label: string, emptyNoun: string, usage: LineItemTypeUsage) {
  const innerX = x + PAD;
  const innerW = CARD_W - 2 * PAD;

  w.rect(x, CARD_Y, CARD_W, CARD_H, COLORS.white, { radius: 6000, border: COLORS.border });
  w.text(innerX, CARD_Y + 180000, innerW, 300000, run(label, { sz: 1400, color: COLORS.orange, bold: true }));
  w.text(innerX, CARD_Y + 500000, innerW, 520000, run(fmtMoneyCompact(usage.totalRevenue), { sz: 2800, color: COLORS.ink, bold: true }), {
    anchor: "ctr",
    wrap: "none",
  });
  w.text(
    innerX,
    CARD_Y + 1040000,
    innerW,
    260000,
    run(`${fmtInt(usage.distinctItems)} items  ·  used on ${fmtInt(usage.jobCount)} jobs`, { sz: 1000, color: COLORS.muted })
  );
  w.rect(innerX, CARD_Y + 1380000, innerW, 9525, COLORS.border);

  if (usage.top.length === 0) {
    w.text(innerX, CARD_Y + 1800000, innerW, 600000, run(`No ${emptyNoun} were recorded on jobs this period`, { sz: 1100, color: COLORS.faint }), {
      algn: "ctr",
    });
    return;
  }

  w.text(innerX, CARD_Y + 1460000, innerW, 200000, run("TOP 5 BY JOBS USED", { sz: 800, color: COLORS.faint, bold: true }));
  const maxJobs = Math.max(...usage.top.map((t) => t.jobCount), 1);
  usage.top.forEach((item, i) => {
    w.barRow(
      innerX,
      CARD_Y + 1720000 + i * ROW_STEP,
      innerW,
      item.name,
      `${fmtInt(item.jobCount)} jobs  ·  ${fmtMoneyCompact(item.revenue)}`,
      item.jobCount / maxJobs
    );
  });
}

/** Deterministic talking point — every number is read straight off the computed usage. */
export function usageInsight(usage: LineItemUsage): string {
  if (usage.jobsWithLineItems === 0) {
    return "No parts, products or services were recorded on jobs this period. Adding them to jobs unlocks usage, inventory and job-profitability reporting.";
  }
  const leaders = [
    usage.services.top[0] && `${usage.services.top[0].name} was the most-used service (${fmtInt(usage.services.top[0].jobCount)} jobs)`,
    usage.parts.top[0] &&
      `${usage.parts.top[0].name} led parts (${fmtInt(usage.parts.top[0].jobCount)} jobs, ${fmtMoneyCompact(usage.parts.top[0].revenue)})`,
    usage.products.top[0] &&
      `${usage.products.top[0].name} led products (${fmtInt(usage.products.top[0].jobCount)} jobs, ${fmtMoneyCompact(usage.products.top[0].revenue)})`,
  ].filter(Boolean);
  const materialShare = usage.totalRevenue
    ? ((usage.parts.totalRevenue + usage.products.totalRevenue) / usage.totalRevenue) * 100
    : 0;
  return (
    `${leaders.join("; ")}. Parts and products made up ${materialShare.toFixed(0)}% of the ` +
    `${fmtMoneyCompact(usage.totalRevenue)} billed through job line items.`
  );
}

export async function insertUsageSlide(zip: JSZip, usage: LineItemUsage, periodLabel: string): Promise<string> {
  const w = new ShapeWriter();
  w.header(
    "Parts, Products & Services Usage",
    `${periodLabel}  ·  ${fmtInt(usage.jobsWithLineItems)} of ${fmtInt(usage.jobsTotal)} jobs used parts, products or services ` +
      `(${(usage.attachRate * 100).toFixed(1)}%)`
  );
  drawCard(w, CARD_XS[0], "PARTS", "parts", usage.parts);
  drawCard(w, CARD_XS[1], "PRODUCTS", "products", usage.products);
  drawCard(w, CARD_XS[2], "SERVICES", "services", usage.services);
  w.insight(usageInsight(usage));
  w.footer("Source: Zuper Jobs — parts, products & services added to jobs created in the period · ranked by number of jobs using each item");
  return insertGeneratedSlide(zip, INSERT_AFTER, w);
}
