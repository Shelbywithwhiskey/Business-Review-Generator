import type JSZip from "jszip";

// ---------------------------------------------------------------------------
// Speaker notes for every slide in the exported deck. Each slide gets the same
// structure so a CSM can prep from the notes pane alone:
//   WHAT THIS SLIDE SHOWS · CALL OUT · TALKING POINTS · HOW EACH NUMBER IS
//   CALCULATED · DATA COVERAGE & CAVEATS · EDIT BEFORE PRESENTING
// Call-outs and talking points are generated deterministically from the same
// computed metrics the slide renders — never by AI — so every number in the
// notes matches the number on the slide.
// ---------------------------------------------------------------------------

/** Evidence classes from SPEC §14.1. Every numeric definition carries one. */
export type EvidenceClass = "Observed activity" | "Observed change" | "Current state" | "Configuration" | "Insufficient data";

export interface MetricDefinition {
  /** The label as it appears on the slide. */
  label: string;
  /** The exact value shown on the slide, if any. */
  value?: string;
  /** How it's calculated, in plain words. */
  definition: string;
  /** Zuper module(s) the rows come from. */
  source: string;
  evidence?: EvidenceClass;
}

export interface SlideNotes {
  purpose: string;
  callouts?: string[];
  talkingPoints?: string[];
  metrics?: MetricDefinition[];
  caveats?: string[];
  /** Static template content the CSM must update by hand before presenting. */
  editBeforePresenting?: string[];
}

const NOTES_MASTER = "../notesMasters/notesMaster1.xml";
const NOTES_CT = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const REL_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function para(text: string, { bold = false, bullet = false } = {}): string {
  const pPr = bullet ? `<a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>` : "";
  return `<a:p>${pPr}<a:r><a:rPr lang="en-US" sz="1200"${bold ? ' b="1"' : ""} dirty="0"/><a:t>${esc(text)}</a:t></a:r></a:p>`;
}

function blank(): string {
  return `<a:p><a:endParaRPr lang="en-US" sz="1200"/></a:p>`;
}

/** Notes body paragraphs, in the fixed section order. Empty sections are omitted. */
export function renderNotesParagraphs(n: SlideNotes): string {
  const out: string[] = [];
  const section = (title: string, lines: string[] | undefined) => {
    if (!lines?.length) return;
    if (out.length) out.push(blank());
    out.push(para(title, { bold: true }));
    for (const l of lines) out.push(para(l, { bullet: true }));
  };

  out.push(para("WHAT THIS SLIDE SHOWS", { bold: true }), para(n.purpose));
  section("CALL OUT", n.callouts);
  section("TALKING POINTS", n.talkingPoints);
  section(
    "HOW EACH NUMBER IS CALCULATED",
    n.metrics?.map(
      (m) => `${m.label}${m.value ? ` = ${m.value}` : ""}: ${m.definition} Source: ${m.source}.${m.evidence ? ` Evidence: ${m.evidence}.` : ""}`
    )
  );
  section("DATA COVERAGE & CAVEATS", n.caveats);
  section("EDIT BEFORE PRESENTING", n.editBeforePresenting);
  return out.join("");
}

/** Plain-text rendering (same content as the notes pane) — used by tests and the web report. */
export function renderNotesText(n: SlideNotes): string {
  return renderNotesParagraphs(n)
    .replace(/<\/a:p>/g, "\n")
    .replace(/<a:buChar char="•"\/>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function notesSlideXml(body: string, slideNo: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{F7021451-1387-4CA6-816F-3879F97B5CBC}" type="slidenum"><a:rPr lang="en-US"/><a:t>${slideNo}</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

/** Replaces the text of the notes body placeholder (ph type="body"), keeping every other notes shape as-is. */
function replaceNotesBody(xml: string, body: string): string | null {
  const bodyShape = xml.match(/<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph type="body"[\s\S]*?<\/p:sp>/)?.[0];
  if (!bodyShape) return null;
  const updated = bodyShape.includes("<p:txBody>")
    ? bodyShape.replace(/<p:txBody>[\s\S]*<\/p:txBody>/, `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody>`)
    : bodyShape.replace("</p:sp>", `<p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`);
  return xml.replace(bodyShape, updated);
}

/**
 * Writes `notes` into the speaker notes of `slidePath` (e.g. "ppt/slides/slide13.xml").
 * Template slides already own a notesSlide part — its body text is replaced (the CSM's
 * template notes are superseded by data-specific ones). Generated slides get a new part.
 */
export async function setSlideNotes(zip: JSZip, slidePath: string, notes: SlideNotes): Promise<void> {
  const body = renderNotesParagraphs(notes);
  const slideName = slidePath.split("/").pop()!;
  const slideRelsPath = `ppt/slides/_rels/${slideName}.rels`;
  const slideRels = (await zip.file(slideRelsPath)?.async("string")) ?? "";
  const existingTarget = slideRels.match(/<Relationship [^>]*notesSlide"[^>]*Target="\.\.\/notesSlides\/([^"]+)"/)?.[1]
    ?? slideRels.match(/<Relationship [^>]*Target="\.\.\/notesSlides\/([^"]+)"[^>]*notesSlide"/)?.[1];

  if (existingTarget) {
    const notesPath = `ppt/notesSlides/${existingTarget}`;
    const xml = await zip.file(notesPath)?.async("string");
    const replaced = xml ? replaceNotesBody(xml, body) : null;
    if (replaced) {
      zip.file(notesPath, replaced);
      return;
    }
  }

  // New notes part: notesSlideN.xml + its rels (slide + master) + slide rel + content type.
  let n = 1;
  while (zip.file(`ppt/notesSlides/notesSlide${n}.xml`)) n += 1;
  const notesName = `notesSlide${n}.xml`;
  const slideNo = Number(slideName.match(/\d+/)?.[0] ?? 0);
  zip.file(`ppt/notesSlides/${notesName}`, notesSlideXml(body, slideNo));
  zip.file(
    `ppt/notesSlides/_rels/${notesName}.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="${NOTES_MASTER}"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/${slideName}"/></Relationships>`
  );
  const withoutOld = slideRels.replace(/<Relationship [^>]*relationships\/notesSlide"[^>]*\/>/g, "");
  zip.file(
    slideRelsPath,
    withoutOld.replace("</Relationships>", `<Relationship Id="rIdNotes1" Type="${REL_NOTES}" Target="../notesSlides/${notesName}"/></Relationships>`)
  );
  const ctPath = "[Content_Types].xml";
  const ct = await zip.file(ctPath)!.async("string");
  zip.file(ctPath, ct.replace("</Types>", `<Override PartName="/ppt/notesSlides/${notesName}" ContentType="${NOTES_CT}"/></Types>`));
}
