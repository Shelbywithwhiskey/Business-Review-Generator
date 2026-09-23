import type JSZip from "jszip";

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

export class ShapeWriter {
  private nextId = 100;
  readonly shapes: string[] = [];

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

/** Builds a slide from `shapes` on the style source's background and registers it in the deck right after `afterSlide`. */
export async function insertGeneratedSlide(zip: JSZip, afterSlide: string, shapes: ShapeWriter): Promise<void> {
  const styleXml = await readText(zip, STYLE_SOURCE);
  const styleRels = await readText(zip, STYLE_SOURCE.replace("slides/", "slides/_rels/") + ".rels");
  const backgroundPic = styleXml.match(/<p:pic>[\s\S]*?<\/p:pic>/)?.[0] ?? "";
  // Same layout + background image as the style source, minus its speaker notes.
  const slideRels = styleRels.replace(/<Relationship [^>]*relationships\/notesSlide"[^>]*\/>/g, "");

  const slideXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    backgroundPic +
    shapes.shapes.join("") +
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
      `<Override PartName="/ppt/slides/${slideName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`
    )
  );
}
