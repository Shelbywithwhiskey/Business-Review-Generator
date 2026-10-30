import type JSZip from "jszip";
import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, isPositive, run, truncate } from "./generatedSlide";
import { TONE_LABEL, rank, type Callout } from "@/lib/reports/callouts";
import { HEALTH_LABEL, type AccountBrief, type BriefItem } from "@/lib/reports/accountBrief";

// ---------------------------------------------------------------------------
// Account Brief slide (after Highlights) and the closing reference slide.
// The deck is shown to the customer, so the brief slide carries positive
// content only — the business read, what's working, growth vs last year,
// opportunities. Everything negative (risks, watch items, the health read)
// is gathered on the last slide, marked for the account manager's reference.
// ---------------------------------------------------------------------------

type Column = { title: string; ink: string; fill: string; items: BriefItem[] };

export function accountBriefSlide(customerName: string, brief: AccountBrief): ShapeWriter {
  const w = new ShapeWriter();
  w.header(`Account Brief — ${truncate(customerName, 40)}`, `${brief.reviewName}  ·  ${brief.periodLabel}`);

  // Business read across the top.
  const readY = 1300000;
  const readH = 900000;
  w.rect(CONTENT_X, readY, CONTENT_W, readH, COLORS.white, { radius: 6000, border: COLORS.border });
  w.text(CONTENT_X + 180000, readY + 110000, 3000000, 220000, run("THE BUSINESS", { sz: 900, color: COLORS.orange, bold: true }), { wrap: "none" });
  w.text(CONTENT_X + 180000, readY + 340000, CONTENT_W - 360000, readH - 400000, run(truncate(brief.businessRead, 420), { sz: 1050, color: COLORS.ink }));

  // Middle column: growth vs last year when there is a comparison, otherwise more of what's working.
  const columns: Column[] = [
    { title: "WHAT'S WORKING", ink: "0B7A0B", fill: "E7F6E7", items: brief.highlights.slice(0, 3) },
    brief.growth.length
      ? { title: "GROWTH VS LAST YEAR", ink: "0B7A0B", fill: "E7F6E7", items: brief.growth.slice(0, 3) }
      : { title: "MORE WINS", ink: "0B7A0B", fill: "E7F6E7", items: brief.highlights.slice(3, 6) },
    { title: "OPPORTUNITIES", ink: "C03D00", fill: "FFF0E6", items: brief.opportunities.slice(0, 3) },
  ];
  const gap = 150000;
  const colW = (CONTENT_W - gap * 2) / 3;
  const colY = readY + readH + 150000;
  const colH = 5700000 - colY;
  columns.forEach((col, i) => {
    const x = CONTENT_X + i * (colW + gap);
    w.rect(x, colY, colW, colH, COLORS.white, { radius: 5000, border: COLORS.border });
    w.rect(x + 160000, colY + 140000, colW - 320000, 260000, col.fill, { radius: 50000 });
    w.text(x + 160000, colY + 140000, colW - 320000, 260000, run(col.title, { sz: 850, color: col.ink, bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
    const rowH = (colH - 520000) / 3;
    col.items.forEach((it, k) => {
      const y = colY + 480000 + k * rowH;
      // One text box with a line break, so the detail follows the headline whether it wraps or not.
      w.text(x + 160000, y, colW - 320000, rowH - 60000, run(truncate(it.headline, 80), { sz: 1050, color: COLORS.ink, bold: true }) + "<a:br/>" + run(truncate(it.detail, 150), { sz: 850, color: COLORS.muted }));
    });
    if (!col.items.length) w.text(x + 160000, colY + 600000, colW - 320000, 400000, run("More to build on next period.", { sz: 950, color: COLORS.faint }));
  });

  w.footer(
    [brief.source === "ai" ? "Written by AI from this deck's findings and the account's company notes; every number is checked against the findings" : "Built from this deck's ranked findings", brief.excludedNote]
      .filter(Boolean)
      .join("  ·  ")
  );
  w.notes = {
    purpose: "The account manager's read of the account in one slide: the business, what's working, growth, and where to go next. Risks and the health read are on the last slide, for you only.",
    talkingPoints: [...brief.talkingPoints, ...brief.questions.map((q) => `ASK: ${q}`)],
    caveats: [
      brief.source === "ai"
        ? "Written by Gemini from the deck's computed findings plus the 'About the company' notes; the website is used for framing only. Any output with a number not in those findings is rejected."
        : "AI was unavailable or its output failed a check, so this is the rule-based version built straight from the ranked findings.",
      ...(brief.excludedNote ? [brief.excludedNote] : []),
    ],
  };
  return w;
}

/**
 * The closing slide: every risk and watch item in the deck (kept off the other slides), ranked, with the
 * account health read and the brief's risks. For the account manager — remove or hide before sharing.
 */
export function referenceSlide(customerName: string, all: Callout[], brief: AccountBrief): ShapeWriter {
  const w = new ShapeWriter();
  w.header("For Your Reference — Watch Items", `${truncate(customerName, 40)}  ·  internal: hide or delete this slide before sharing the deck`);

  // Health read.
  const hy = 1300000;
  w.rect(CONTENT_X, hy, CONTENT_W, 520000, COLORS.white, { radius: 8000, border: COLORS.border });
  w.text(CONTENT_X + 180000, hy, 2600000, 520000, run(`ACCOUNT HEALTH: ${HEALTH_LABEL[brief.health.status].toUpperCase()}`, { sz: 1000, color: brief.health.status === "at_risk" ? COLORS.alert : COLORS.orange, bold: true }), { anchor: "ctr", wrap: "none" });
  w.text(CONTENT_X + 2900000, hy, CONTENT_W - 3080000, 520000, run(truncate(brief.health.why, 160), { sz: 950, color: COLORS.ink }), { anchor: "ctr" });

  // Ranked risks and watch items, de-duplicated, two columns of up to five.
  const seen = new Set<string>();
  const items = rank(all.filter((c) => !isPositive(c))).filter((c) => !seen.has(c.headline) && seen.add(c.headline)).slice(0, 10);
  const gap = 150000;
  const colW = (CONTENT_W - gap) / 2;
  const top = hy + 520000 + 150000;
  const rowH = (5750000 - top) / 5;
  if (!items.length) {
    w.empty({ x: CONTENT_X, y: top, cx: CONTENT_W, cy: 5750000 - top }, "Nothing flagged as a risk or watch item this period.");
  }
  items.forEach((c, i) => {
    // Alternate columns so a short list spreads across the slide, highest-ranked first.
    const x = CONTENT_X + (i % 2) * (colW + gap);
    const y = top + Math.floor(i / 2) * rowH;
    w.rect(x, y, colW, rowH - 80000, COLORS.white, { radius: 6000, border: COLORS.border });
    w.text(
      x + 160000,
      y + 60000,
      colW - 320000,
      rowH - 200000,
      run(`${TONE_LABEL[c.tone]}  ·  ${c.area.toUpperCase()}`, { sz: 750, color: c.tone === "risk" ? COLORS.alert : COLORS.muted, bold: true }) +
        "<a:br/>" +
        run(truncate(c.headline, 85), { sz: 1000, color: COLORS.ink, bold: true }) +
        "<a:br/>" +
        run(truncate(c.detail.replace(/^./, (s) => s.toUpperCase()), 120), { sz: 800, color: COLORS.muted })
    );
  });

  w.footer("Every risk and watch item from the deck's findings, ranked by materiality · kept off the customer-facing slides");
  w.notes = {
    purpose: "Your private prep: what could hurt the account, ranked. None of this appears on the customer-facing slides. Hide or delete this slide before sharing the deck.",
    callouts: [`ACCOUNT HEALTH: ${HEALTH_LABEL[brief.health.status]} — ${brief.health.why}`, ...brief.risks.map((r) => `RISK: ${r.headline} — ${r.detail}`)],
    talkingPoints: brief.nextActions.map((a) => `NEXT ACTION: ${a}`),
    caveats: ["Ranking is by a fixed materiality score (money at stake, share of work affected), not by AI."],
    editBeforePresenting: ["Hide or delete this slide before sending the deck to the customer."],
  };
  return w;
}

/** The deck's current last slide (presentation order), so the reference slide can follow it. */
export async function lastSlidePath(zip: JSZip): Promise<string> {
  const pres = (await zip.file("ppt/presentation.xml")!.async("string")).match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/)?.[1] ?? "";
  const lastRid = [...pres.matchAll(/r:id="([^"]+)"/g)].pop()?.[1];
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const target = rels.match(new RegExp(`<Relationship [^>]*Id="${lastRid}"[^>]*/>`))?.[0].match(/Target="([^"]+)"/)?.[1];
  if (!target) throw new Error("Could not find the deck's last slide");
  return `ppt/${target.replace(/^\/?ppt\//, "")}`;
}
