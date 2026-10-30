import type JSZip from "jszip";
import { buildChartXml, chartFrameXml, type ChartSpec } from "./nativeChart";
import { setSlideNotes, type SlideNotes } from "./slideNotes";
import { calloutLine, rank, TONE_LABEL, type Callout, type Tone } from "@/lib/reports/callouts";

// ---------------------------------------------------------------------------
// Shared plumbing for slides that aren't in templates/ebr-template.pptx but are
// generated per export (usageSlide.ts, automationSlide.ts): DrawingML shape
// writers, and splicing a new slide into the deck after an existing one. Each
// generated slide reuses the background picture + layout of STYLE_SOURCE so it
// matches the template visually; geometry and colors mirror slide14.
// ---------------------------------------------------------------------------

const STYLE_SOURCE = "ppt/slides/slide14.xml";

export const COLORS = {
  orange: "FD5000",
  ink: "191919",
  muted: "4B5563",
  faint: "7A7268",
  track: "F1F1F1",
  border: "E6E6E6",
  white: "FFFFFF",
  alert: "B5271C",
};

/** Standard 3-card row from slide14. */
export const CARD_XS = [791667, 4383445, 7975222];
export const CARD_W = 3425111;
export const CONTENT_X = 791667;
export const CONTENT_W = 10608666;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoneyCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function run(text: string, { sz, color, bold }: { sz: number; color: string; bold?: boolean }): string {
  return `<a:r><a:rPr lang="en-US" sz="${sz}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

const TONE_COLORS: Record<Tone, string> = { win: "0B7A0B", risk: "B5271C", opportunity: "FD5000", watch: "4B5563" };

/** Slides show positive findings only; risks and watch items go to the closing reference slide. */
export function isPositive(c: Callout): boolean {
  return c.tone === "win" || c.tone === "opportunity";
}

export class ShapeWriter {
  private nextId: number;
  readonly shapes: string[] = [];
  /** Ranked findings for this slide (also collected for the deck's Top Call-outs slide). */
  callouts: Callout[] = [];

  /** startId: first shape id — use a high value when adding shapes to an existing template slide. */
  constructor(startId = 100) {
    this.nextId = startId;
  }
  /** Native charts; each shape entry holds a {{CHART_n}} rId placeholder resolved in insertGeneratedSlide. */
  readonly charts: ChartSpec[] = [];
  /** Speaker notes written alongside the slide (see slideNotes.ts). */
  notes?: SlideNotes;

  chart(x: number, y: number, cx: number, cy: number, spec: ChartSpec) {
    const n = this.charts.push(spec) - 1;
    this.shapes.push(chartFrameXml(this.nextId++, `{{CHART_${n}}}`, x, y, cx, cy));
  }

  /** White rounded card with an orange uppercase title; returns the inner content box. */
  card(x: number, y: number, cx: number, cy: number, title: string) {
    this.rect(x, y, cx, cy, COLORS.white, { radius: 5000, border: COLORS.border });
    this.text(x + 180000, y + 140000, cx - 360000, 240000, run(title, { sz: 1100, color: COLORS.orange, bold: true }), { wrap: "none" });
    return { x: x + 120000, y: y + 420000, cx: cx - 240000, cy: cy - 520000 };
  }

  /**
   * Row of KPI tiles across the content width. A tile with `spark` gets a small trend line under its label.
   * `alert` is accepted but no longer drawn in red: slides present positively, and the matching risk
   * call-out lands on the closing reference slide.
   */
  kpis(y: number, tiles: { value: string; label: string; alert?: boolean; spark?: number[] }[], h = 820000) {
    tiles = tiles.map((t) => ({ ...t, alert: false }));
    const gap = 130000;
    const w = (CONTENT_W - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => {
      const x = CONTENT_X + i * (w + gap);
      const spark = t.spark && t.spark.length >= 3 && t.spark.some((v) => v > 0);
      if (!spark) {
        this.rect(x, y, w, h, COLORS.white, { radius: 10000, border: COLORS.border });
        this.text(x, y + 90000, w, 400000, run(t.value, { sz: 2200, color: t.alert ? COLORS.alert : COLORS.orange, bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
        this.text(x + 80000, y + 500000, w - 160000, 280000, run(t.label, { sz: 900, color: COLORS.muted }), { algn: "ctr" });
        return;
      }
      // Value + label on the left, trend on the right.
      this.rect(x, y, w, h, COLORS.white, { radius: 10000, border: COLORS.border });
      this.text(x + 110000, y + 90000, w * 0.56, 400000, run(t.value, { sz: 2000, color: t.alert ? COLORS.alert : COLORS.orange, bold: true }), { anchor: "ctr", wrap: "none" });
      this.text(x + 110000, y + 500000, w * 0.56, 280000, run(t.label, { sz: 850, color: COLORS.muted }));
      this.chart(x + w * 0.6, y + 140000, w * 0.36, h - 280000, { kind: "spark", categories: t.spark!.map((_, k) => String(k)), series: [{ name: t.label, values: t.spark!, color: t.alert ? COLORS.alert : COLORS.orange }] });
    });
  }

  /** Big headline figure with a caption — for "the one number" moments. */
  hero(x: number, y: number, cx: number, value: string, caption: string, color = COLORS.orange, captionColor: string = COLORS.muted) {
    this.text(x, y, cx, 560000, run(value, { sz: 3600, color, bold: true }), { wrap: "none" });
    this.text(x, y + 580000, cx, 300000, run(caption, { sz: 1050, color: captionColor }));
  }

  /**
   * Before → after row (dumbbell): gray dot = before, orange dot = now, on the row's own scale,
   * with a Better/Worse chip. Status color carries meaning and always comes with an arrow + word.
   */
  dumbbell(x: number, y: number, cx: number, row: { label: string; before: number; after: number; beforeText: string; afterText: string; improved: boolean; delta: string }) {
    const labelW = cx * 0.3;
    const chipW = 1150000;
    const trackX = x + labelW + 120000;
    const trackW = cx - labelW - chipW - 400000;
    const max = Math.max(row.before, row.after, 1e-9) * 1.1;
    const px = (v: number) => trackX + (Math.max(v, 0) / max) * trackW;
    this.text(x, y, labelW, 360000, run(row.label, { sz: 1050, color: COLORS.ink, bold: true }), { anchor: "ctr" });
    this.rect(trackX, y + 165000, trackW, 30000, COLORS.track);
    const a = px(row.before);
    const b = px(row.after);
    this.rect(Math.min(a, b), y + 160000, Math.max(Math.abs(b - a), 20000), 40000, row.improved ? "9BD39B" : "F1A9A0");
    this.rect(a - 70000, y + 110000, 140000, 140000, "9CA3AF", { radius: 50000 });
    this.rect(b - 80000, y + 100000, 160000, 160000, COLORS.orange, { radius: 50000 });
    this.text(a - 450000, y - 60000, 900000, 180000, run(row.beforeText, { sz: 800, color: COLORS.muted }), { algn: "ctr", wrap: "none" });
    this.text(b - 450000, y + 250000, 900000, 180000, run(row.afterText, { sz: 850, color: COLORS.ink, bold: true }), { algn: "ctr", wrap: "none" });
    const chipX = x + cx - chipW;
    this.rect(chipX, y + 70000, chipW, 220000, row.improved ? "E7F6E7" : "FBE9E7", { radius: 50000 });
    this.text(chipX, y + 70000, chipW, 220000, run(`${row.improved ? "▲ Better" : "▼ Worse"} ${row.delta}`, { sz: 800, color: row.improved ? "0B7A0B" : COLORS.alert, bold: true }), { algn: "ctr", anchor: "ctr", wrap: "none" });
  }

  /** Horizontal milestone timeline: dots on a line, labels alternating above and below. */
  timeline(x: number, y: number, cx: number, items: { date: string; label: string }[]) {
    if (!items.length) return;
    this.rect(x, y, cx, 30000, COLORS.orange);
    const step = items.length > 1 ? cx / (items.length - 1) : 0;
    items.forEach((it, i) => {
      const px = items.length > 1 ? x + i * step : x + cx / 2;
      this.rect(px - 90000, y - 75000, 180000, 180000, COLORS.white, { radius: 50000, border: COLORS.orange });
      this.rect(px - 45000, y - 30000, 90000, 90000, COLORS.orange, { radius: 50000 });
      const above = i % 2 === 0;
      const w = Math.min(1700000, Math.max(step, 1300000));
      const ty = above ? y - 620000 : y + 200000;
      this.text(px - w / 2, ty, w, 200000, run(it.date, { sz: 900, color: COLORS.orange, bold: true }), { algn: "ctr", wrap: "none" });
      this.text(px - w / 2, ty + 200000, w, 360000, run(it.label, { sz: 950, color: COLORS.white }), { algn: "ctr" });
    });
  }

  /** Stepped flow (funnel): each stage a bar scaled to its value, with the step-to-step ratio between. */
  funnel(x: number, y: number, cx: number, cy: number, stages: { label: string; value: number; display: string; sub?: string }[]) {
    if (!stages.length) return;
    const max = Math.max(...stages.map((s) => s.value), 1);
    const rowH = cy / stages.length;
    const labelW = cx * 0.28;
    const barMaxW = cx - labelW - 1500000;
    stages.forEach((s, i) => {
      const ry = y + i * rowH;
      const bw = Math.max((s.value / max) * barMaxW, 80000);
      this.text(x, ry, labelW, rowH * 0.62, run(s.label, { sz: 1100, color: COLORS.ink, bold: true }), { anchor: "ctr" });
      const shade = ["FD5000", "FD6F2E", "FE8C57", "FEA981", "FFC6AB"][Math.min(i, 4)];
      this.rect(x + labelW, ry + rowH * 0.1, bw, rowH * 0.42, shade, { radius: 12000 });
      this.text(x + labelW + bw + 100000, ry, 1400000, rowH * 0.62, run(s.display, { sz: 1200, color: COLORS.ink, bold: true }), { anchor: "ctr", wrap: "none" });
      if (s.sub) this.text(x + labelW, ry + rowH * 0.55, barMaxW, rowH * 0.4, run(s.sub, { sz: 850, color: COLORS.muted }), { wrap: "none" });
    });
  }


  /** Centered muted message inside a box — the explicit "no data" state, never an empty chart. */
  empty(box: { x: number; y: number; cx: number; cy: number }, message: string) {
    this.text(box.x, box.y + box.cy / 2 - 250000, box.cx, 500000, run(message, { sz: 1050, color: COLORS.faint }), { algn: "ctr", anchor: "ctr" });
  }

  /** Small white source/definition line under the insight bar: what the data is and when it was synced. */
  footer(text: string) {
    this.text(CONTENT_X, 6420000, CONTENT_W, 220000, run(text, { sz: 750, color: COLORS.white }), { wrap: "none" });
  }

  text(
    x: number,
    y: number,
    cx: number,
    cy: number,
    runs: string,
    { algn = "l", anchor = "t", wrap = "square" }: { algn?: "l" | "ctr" | "r"; anchor?: "t" | "ctr"; wrap?: "square" | "none" } = {}
  ) {
    const id = this.nextId++;
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="${anchor}"/><a:lstStyle/><a:p><a:pPr algn="${algn}"/>${runs}</a:p></p:txBody></p:sp>`
    );
  }

  /** radius is roundRect's adj (fraction of the shorter side, x100000); 0 = square corners. */
  rect(x: number, y: number, cx: number, cy: number, fill: string, { radius = 0, border }: { radius?: number; border?: string } = {}) {
    const id = this.nextId++;
    const geom = radius
      ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${radius}"/></a:avLst></a:prstGeom>`
      : `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`;
    const line = border ? `<a:ln w="7620"><a:solidFill><a:srgbClr val="${border}"/></a:solidFill></a:ln>` : `<a:ln><a:noFill/></a:ln>`;
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>${geom}<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${line}</p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" sz="1000"/></a:p></p:txBody></p:sp>`
    );
  }

  /** White slide title + subtitle, same position/size as the template's section slides. */
  header(title: string, subtitle: string) {
    this.text(CONTENT_X, 316667, 10583333, 433333, run(title, { sz: 2542, color: COLORS.white, bold: true }), { wrap: "none" });
    this.text(CONTENT_X, 791667, 10583333, 383333, run(subtitle, { sz: 1500, color: COLORS.white }));
  }

  /**
   * "KEY CALL-OUTS" strip along the bottom (same footprint as the insight bar): the top 3 ranked
   * positive call-outs (WIN / OPPORTUNITY). Every call-out, risks included, is still recorded for the
   * speaker notes, the Account Brief and the closing reference slide. Falls back to a plain insight line.
   */
  keyCallouts(list: Callout[], fallback: string) {
    const top = rank(list).filter(isPositive).slice(0, 3);
    this.callouts = rank(list);
    if (!top.length) return this.insight(fallback);
    const y = 5840000;
    const h = 560000;
    this.rect(825334, y, 10583333, h, COLORS.white, { radius: 10000 });
    this.text(1000000, y, 1500000, h, run("KEY CALL-OUTS", { sz: 900, color: COLORS.orange, bold: true }), { anchor: "ctr", wrap: "none" });
    const lineH = (h - 60000) / 3;
    top.forEach((c, i) => {
      const ly = y + 30000 + i * lineH + (3 - top.length) * lineH * 0.5;
      const tag = run(`${TONE_LABEL[c.tone]}  `, { sz: 780, color: TONE_COLORS[c.tone], bold: true });
      const body = run(truncate(c.headline, 90), { sz: 860, color: COLORS.ink, bold: true }) + run(truncate(`  —  ${c.detail}`, 130), { sz: 800, color: COLORS.muted });
      this.text(2450000, ly, 8900000, lineH, tag + body, { anchor: "ctr", wrap: "none" });
    });
  }

  /** Bordered card listing positive call-outs with full text — for template slides with free space. */
  calloutPanel(x: number, y: number, cx: number, cy: number, list: Callout[], max = 3) {
    const top = rank(list).filter(isPositive).slice(0, max);
    if (!top.length) return;
    this.rect(x, y, cx, cy, COLORS.white, { radius: 6000, border: COLORS.border });
    this.text(x + 180000, y + 110000, cx - 360000, 220000, run("KEY CALL-OUTS", { sz: 950, color: COLORS.orange, bold: true }), { wrap: "none" });
    const rowH = (cy - 400000) / max;
    top.forEach((c, i) => {
      const ry = y + 380000 + i * rowH;
      this.text(
        x + 180000,
        ry,
        cx - 360000,
        rowH - 20000,
        run(`${TONE_LABEL[c.tone]}  `, { sz: 850, color: TONE_COLORS[c.tone], bold: true }) +
          run(c.headline, { sz: 1000, color: COLORS.ink, bold: true }) +
          run(`  —  ${c.detail}`, { sz: 900, color: COLORS.muted })
      );
    });
  }

  /** "→ Insights" bar along the bottom, as on slide14. */
  insight(text: string) {
    this.rect(825334, 5900000, 10583333, 460000, COLORS.white, { radius: 12857 });
    this.text(1200000, 5930000, 1333333, 400000, run("→ Insights", { sz: 958, color: COLORS.orange, bold: true }), { anchor: "ctr", wrap: "none" });
    this.text(2658334, 5930000, 8608333, 400000, run(text, { sz: 875, color: COLORS.muted }), { anchor: "ctr" });
  }

  /** Label + value row with a proportional bar underneath (value/max). */
  barRow(x: number, y: number, w: number, label: string, value: string, fraction: number, { labelChars = 25 } = {}) {
    const labelW = w * 0.62;
    this.text(x, y, labelW, 220000, run(truncate(label, labelChars), { sz: 1050, color: COLORS.ink }), { anchor: "ctr", wrap: "none" });
    this.text(x + labelW, y, w - labelW, 220000, run(value, { sz: 950, color: COLORS.muted }), { algn: "r", anchor: "ctr" });
    this.rect(x, y + 260000, w, 90000, COLORS.track, { radius: 50000 });
    this.rect(x, y + 260000, Math.max(w * Math.min(fraction, 1), 60000), 90000, COLORS.orange, { radius: 50000 });
  }
}

function readAttr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

async function readText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);
  if (!file) throw new Error(`PPTX template is missing ${filePath}`);
  return file.async("string");
}

// Call-outs from every slide inserted into a deck, for its Top Call-outs summary.
const deckCallouts = new WeakMap<JSZip, Callout[]>();
export function collectedCallouts(zip: JSZip): Callout[] {
  return deckCallouts.get(zip) ?? [];
}
export function collectCallouts(zip: JSZip, list: Callout[]) {
  deckCallouts.set(zip, [...collectedCallouts(zip), ...list]);
}

/** Adds `shapes` (text/rect only — no charts) on top of an existing slide's content. */
export async function appendShapesToSlide(zip: JSZip, slidePath: string, shapes: ShapeWriter): Promise<void> {
  const xml = await readText(zip, slidePath);
  zip.file(slidePath, xml.replace("</p:spTree>", `${shapes.shapes.join("")}</p:spTree>`));
}

/** Builds a slide from `shapes` on the style source's background and registers it in the deck right after
 * `afterSlide` (a template slide path, or one returned by a previous call). Returns the new slide's path. */
export async function insertGeneratedSlide(zip: JSZip, afterSlide: string, shapes: ShapeWriter): Promise<string> {
  const styleXml = await readText(zip, STYLE_SOURCE);
  const styleRels = await readText(zip, STYLE_SOURCE.replace("slides/", "slides/_rels/") + ".rels");
  const backgroundPic = styleXml.match(/<p:pic>[\s\S]*?<\/p:pic>/)?.[0] ?? "";
  // Same layout + background image as the style source, minus its speaker notes.
  let slideRels = styleRels.replace(/<Relationship [^>]*relationships\/notesSlide"[^>]*\/>/g, "");

  // Native chart parts: ppt/charts/chartN.xml + a slide relationship + a content-type override each.
  let body = shapes.shapes.join("");
  const chartOverrides: string[] = [];
  let chartNo = 1;
  for (const [i, spec] of shapes.charts.entries()) {
    while (zip.file(`ppt/charts/chart${chartNo}.xml`)) chartNo += 1;
    const chartPath = `ppt/charts/chart${chartNo}.xml`;
    zip.file(chartPath, buildChartXml(spec));
    const rId = `rIdChart${i + 1}`;
    slideRels = slideRels.replace(
      "</Relationships>",
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/></Relationships>`
    );
    body = body.replace(`{{CHART_${i}}}`, rId);
    chartOverrides.push(`<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  }

  const slideXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    backgroundPic +
    body +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  let slideNo = 1;
  while (zip.file(`ppt/slides/slide${slideNo}.xml`)) slideNo += 1;
  const slideName = `slide${slideNo}.xml`;
  zip.file(`ppt/slides/${slideName}`, slideXml);
  zip.file(`ppt/slides/_rels/${slideName}.rels`, slideRels);

  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  let presRels = await readText(zip, presRelsPath);
  const relTags = presRels.match(/<Relationship [^>]*\/>/g) ?? [];
  const afterTarget = afterSlide.replace(/^ppt\//, "");
  const afterRid = relTags.map((t) => (readAttr(t, "Target") === afterTarget ? readAttr(t, "Id") : null)).find(Boolean);
  if (!afterRid) throw new Error(`PPTX template has no presentation relationship for ${afterSlide}`);
  const maxRid = Math.max(0, ...relTags.map((t) => Number(readAttr(t, "Id")?.replace(/^rId/, "") ?? 0)));
  const newRid = `rId${maxRid + 1}`;
  presRels = presRels.replace(
    "</Relationships>",
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${slideName}"/></Relationships>`
  );
  zip.file(presRelsPath, presRels);

  const presPath = "ppt/presentation.xml";
  let pres = await readText(zip, presPath);
  const afterTag = pres.match(new RegExp(`<p:sldId [^>]*r:id="${afterRid}"[^>]*/>`))?.[0];
  if (!afterTag) throw new Error(`PPTX template slide list has no entry for ${afterSlide}`);
  const maxSldId = Math.max(...[...pres.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => Number(m[1])));
  pres = pres.replace(afterTag, `${afterTag}<p:sldId id="${maxSldId + 1}" r:id="${newRid}"/>`);
  zip.file(presPath, pres);

  const ctPath = "[Content_Types].xml";
  const contentTypes = await readText(zip, ctPath);
  zip.file(
    ctPath,
    contentTypes.replace(
      "</Types>",
      `<Override PartName="/ppt/slides/${slideName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${chartOverrides.join("")}</Types>`
    )
  );
  collectCallouts(zip, shapes.callouts);
  if (shapes.notes) {
    // The slide's ranked call-outs lead the notes' CALL OUT section (same wording as on the slide).
    const lines = shapes.callouts.map(calloutLine);
    const rest = (shapes.notes.callouts ?? []).filter((c) => !lines.some((l) => l.includes(c.slice(0, 40))));
    await setSlideNotes(zip, `ppt/slides/${slideName}`, { ...shapes.notes, callouts: [...lines, ...rest] });
  }
  return `ppt/slides/${slideName}`;
}
