import type JSZip from "jszip";
import type { LineItemTypeUsage, LineItemUsage } from "@/lib/analytics";
import { CARD_W, CARD_XS, COLORS, ShapeWriter, fmtInt, fmtMoneyCompact, insertGeneratedSlide, run, truncate } from "./generatedSlide";

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

  w.text(innerX, CARD_Y + 1460000, innerW, 200000, run("TOP 5 BY AMOUNT", { sz: 800, color: COLORS.faint, bold: true }));
  const maxRevenue = Math.max(...usage.top.map((t) => t.revenue), 1);
  usage.top.forEach((item, i) => {
    w.barRow(
      innerX,
      CARD_Y + 1720000 + i * ROW_STEP,
      innerW,
      item.name,
      `${fmtMoneyCompact(item.revenue)}  ·  ${fmtInt(item.jobCount)} jobs`,
      item.revenue / maxRevenue,
      { labelChars: 22 }
    );
  });
}

/** Deterministic talking point — every number is read straight off the computed usage. */
export function usageInsight(usage: LineItemUsage): string {
  if (usage.jobsWithLineItems === 0) {
    return "No parts, products or services were recorded on jobs this period. Adding them to jobs unlocks usage, inventory and job-profitability reporting.";
  }
  const lead = usage.byType[0];
  if (lead && !["PARTS", "PRODUCT", "SERVICE"].includes(lead.type) && lead.usage.top[0]) {
    return `${lead.label} carry ${fmtMoneyCompact(lead.usage.totalRevenue)} of the ${fmtMoneyCompact(usage.totalRevenue)} on job line items; the largest is ${lead.usage.top[0].name} (${fmtMoneyCompact(lead.usage.top[0].revenue)}).`;
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
  // Show the three line-item types that actually carry value on this account (e.g. Bundles for a
  // roofer), not a fixed Parts/Products/Services trio that can all be near zero.
  const types = usage.byType.filter((t) => t.usage.totalRevenue > 0 || t.usage.jobCount > 0).slice(0, 3);
  const shown = types.length ? types : [
    { type: "PARTS", label: "Parts", usage: usage.parts },
    { type: "PRODUCT", label: "Products", usage: usage.products },
    { type: "SERVICE", label: "Services", usage: usage.services },
  ];
  w.header(
    "What Goes on Jobs — Line Items",
    `${periodLabel}  ·  ${fmtInt(usage.jobsWithLineItems)} of ${fmtInt(usage.jobsTotal)} jobs have line items (${(usage.attachRate * 100).toFixed(1)}%)  ·  ${fmtMoneyCompact(usage.totalRevenue)} in total`
  );
  shown.forEach((t, i) => drawCard(w, CARD_XS[i], t.label.toUpperCase(), t.label.toLowerCase(), t.usage));
  const lead = shown[0];
  const leadItem = lead?.usage.top[0];
  const leadShare = usage.totalRevenue && lead ? lead.usage.totalRevenue / usage.totalRevenue : 0;
  const itemShare = usage.totalRevenue && leadItem ? leadItem.revenue / usage.totalRevenue : 0;
  w.keyCallouts(
    [
      ...(leadItem && itemShare >= 0.3
        ? [{ tone: "watch" as const, headline: `"${truncate(leadItem.name, 40)}" is ${(itemShare * 100).toFixed(0)}% of line-item value (${fmtMoneyCompact(leadItem.revenue)})`, detail: `on ${fmtInt(leadItem.jobCount)} jobs — the account's core offering.`, score: 50, area: "Line items" }]
        : []),
      ...(lead && leadShare >= 0.6 && shown.length > 1
        ? [{ tone: "watch" as const, headline: `${lead.label} make up ${(leadShare * 100).toFixed(0)}% of what's billed on jobs`, detail: `${fmtInt(lead.usage.distinctItems)} different items across ${fmtInt(lead.usage.jobCount)} jobs.`, score: 36, area: "Line items" }]
        : []),
      ...(usage.jobsTotal >= 50 && usage.attachRate < 0.3
        ? [{ tone: "opportunity" as const, headline: `Only ${(usage.attachRate * 100).toFixed(0)}% of jobs have line items`, detail: "adding what's used on each job unlocks job costing, profitability and inventory reporting.", score: 48, area: "Line items" }]
        : []),
    ],
    usageInsight(usage)
  );
  w.footer("Source: Zuper Jobs — line items (products[]) on jobs created in the period, by product type · ranked by amount");
  const topOf = (u: LineItemTypeUsage, kind: string) =>
    u.top[0] ? `Top ${kind}: ${u.top[0].name} — ${fmtInt(u.top[0].jobCount)} jobs, ${fmtMoneyCompact(u.top[0].revenue)}.` : null;
  w.notes = {
    purpose: "What the field team actually uses on jobs: parts, products and services added as job line items.",
    callouts: [
      `${fmtInt(usage.jobsWithLineItems)} of ${fmtInt(usage.jobsTotal)} jobs (${(usage.attachRate * 100).toFixed(1)}%) have parts, products or services on them.`,
      ...[topOf(usage.services, "service"), topOf(usage.parts, "part"), topOf(usage.products, "product")].filter((x): x is string => Boolean(x)),
      ...(usage.attachRate < 0.3 && usage.jobsTotal > 20
        ? ["Most jobs have no line items — adding parts/services to jobs unlocks job costing, profitability and inventory reporting."]
        : []),
    ],
    metrics: [
      { label: "Amount per card", definition: "Sum of line-item totals (quantity × price) for that type on jobs created in the period.", source: "Zuper Jobs (products[] on each job)", evidence: "Observed activity" },
      { label: "Items / jobs", definition: "Distinct items of that type, and the number of jobs using at least one.", source: "Zuper Jobs", evidence: "Observed activity" },
      { label: "Top 5", definition: "Ranked by number of jobs using the item; the amount is its line-item total.", source: "Zuper Jobs", evidence: "Observed activity" },
    ],
    caveats: ["Line-item totals are what was put on the job, not necessarily what was invoiced or paid.", "Type (Parts / Product / Service) is as set on each product in Zuper."],
  };
  return insertGeneratedSlide(zip, INSERT_AFTER, w);
}
