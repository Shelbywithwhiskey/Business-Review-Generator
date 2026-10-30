import { COLORS, CONTENT_W, CONTENT_X, ShapeWriter, run, truncate } from "./generatedSlide";
import { HEALTH_LABEL, type AccountBrief, type BriefItem } from "@/lib/reports/accountBrief";

// ---------------------------------------------------------------------------
// The Account Brief as one slide after Top Call-outs. The deck is shown to the
// customer, so the slide carries what can be said in the room (business read,
// wins, areas to watch, opportunities); the account manager's own prep — health
// read, next actions, questions to ask — goes in the speaker notes.
// ---------------------------------------------------------------------------

const COLUMNS: { key: "highlights" | "risks" | "opportunities"; title: string; ink: string; fill: string }[] = [
  { key: "highlights", title: "WHAT'S WORKING", ink: "0B7A0B", fill: "E7F6E7" },
  { key: "risks", title: "AREAS TO WATCH", ink: "B5271C", fill: "FBE9E7" },
  { key: "opportunities", title: "OPPORTUNITIES", ink: "C03D00", fill: "FFF0E6" },
];

export function accountBriefSlide(customerName: string, brief: AccountBrief): ShapeWriter {
  const w = new ShapeWriter();
  w.header(`Account Brief — ${truncate(customerName, 40)}`, `How the business is running on Zuper, ${brief.periodLabel}`);

  // Business read across the top.
  const readY = 1300000;
  const readH = 900000;
  w.rect(CONTENT_X, readY, CONTENT_W, readH, COLORS.white, { radius: 6000, border: COLORS.border });
  w.text(CONTENT_X + 180000, readY + 110000, 3000000, 220000, run("THE BUSINESS", { sz: 900, color: COLORS.orange, bold: true }), { wrap: "none" });
  w.text(CONTENT_X + 180000, readY + 340000, CONTENT_W - 360000, readH - 400000, run(truncate(brief.businessRead, 420), { sz: 1050, color: COLORS.ink }));

  // Three columns of up to three items.
  const gap = 150000;
  const colW = (CONTENT_W - gap * 2) / 3;
  const colY = readY + readH + 150000;
  const colH = 5700000 - colY;
  COLUMNS.forEach((col, i) => {
    const x = CONTENT_X + i * (colW + gap);
    w.rect(x, colY, colW, colH, COLORS.white, { radius: 5000, border: COLORS.border });
    w.rect(x + 160000, colY + 140000, colW - 320000, 260000, col.fill, { radius: 50000 });
    w.text(x + 160000, colY + 140000, colW - 320000, 260000, run(col.title, { sz: 850, color: col.ink, bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
    const items: BriefItem[] = brief[col.key].slice(0, 3);
    const rowH = (colH - 520000) / 3;
    items.forEach((it, k) => {
      const y = colY + 480000 + k * rowH;
      // One text box with a line break, so the detail follows the headline whether it wraps or not.
      w.text(
        x + 160000,
        y,
        colW - 320000,
        rowH - 60000,
        run(truncate(it.headline, 80), { sz: 1050, color: COLORS.ink, bold: true }) + "<a:br/>" + run(truncate(it.detail, 150), { sz: 850, color: COLORS.muted })
      );
    });
    if (!items.length) w.text(x + 160000, colY + 600000, colW - 320000, 400000, run("Nothing flagged this period.", { sz: 950, color: COLORS.faint }));
  });

  w.footer(
    [brief.source === "ai" ? "Written by AI from this deck's findings and the account's company notes; every number is checked against the findings" : "Built from this deck's ranked findings", brief.excludedNote]
      .filter(Boolean)
      .join("  ·  ")
  );

  w.notes = {
    purpose: "The account manager's read of the account: what the business is, how it's really using Zuper, and what to steer the conversation towards. Slide content is customer-safe; the prep below is for you.",
    callouts: [`ACCOUNT HEALTH: ${HEALTH_LABEL[brief.health.status]} — ${brief.health.why}`, ...brief.risks.map((r) => `RISK: ${r.headline} — ${r.detail}`)],
    talkingPoints: [...brief.nextActions.map((a) => `NEXT ACTION: ${a}`), ...brief.questions.map((q) => `ASK: ${q}`)],
    caveats: [
      brief.source === "ai"
        ? "Written by Gemini from the deck's computed findings plus the 'About the company' notes; the website is used for framing only. Any output with a number not in those findings is rejected."
        : "AI was unavailable or its output failed a check, so this is the rule-based version built straight from the ranked findings.",
      ...(brief.excludedNote ? [brief.excludedNote] : []),
    ],
  };
  return w;
}
