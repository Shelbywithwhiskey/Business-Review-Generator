import { readFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import { buildEbrTokenData, computeSharedDeckData, type RunFix } from "./ebrTokens";
import { setSlideNotes } from "./slideNotes";
import { ShapeWriter, appendShapesToSlide, collectCallouts } from "./generatedSlide";
import { calloutLine } from "@/lib/reports/callouts";
import { injectLineChartData } from "./chartData";
import { insertUsageSlide } from "./usageSlide";
import { insertAutomationSlide } from "./automationSlide";
import { insertModuleSlides } from "./moduleSlides";

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "ebr-template.pptx");

const CHART_FILES: Record<string, keyof Awaited<ReturnType<typeof buildEbrTokenData>>["charts"]> = {
  "ppt/charts/chart1.xml": "chart1",
  "ppt/charts/chart2.xml": "chart2",
  "ppt/charts/chart3.xml": "chart3",
  "ppt/charts/chart4.xml": "chart4",
  "ppt/charts/chart5.xml": "chart5",
  "ppt/charts/chart6.xml": "chart6",
};

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rewrites specific <a:t> runs by position; a run is only changed if it still reads `expect`. */
function applyRunFixes(xml: string, fixes: RunFix[]): string {
  let i = -1;
  return xml.replace(/<a:t>([^<]*)<\/a:t>/g, (whole, text: string) => {
    i += 1;
    const fix = fixes.find((f) => f.index === i);
    return fix && text === fix.expect ? `<a:t>${escXml(fix.text)}</a:t>` : whole;
  });
}

function replaceTokens(xml: string, tokens: Record<string, string>): string {
  let out = xml;
  for (const [key, value] of Object.entries(tokens)) {
    if (!out.includes(`{{${key}}}`)) continue;
    // Value is plain display text going into an <a:t> node — escape XML special chars.
    const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    out = out.split(`{{${key}}}`).join(escaped);
  }
  return out;
}

export interface GenerateEbrPptxOptions {
  customerId: string;
  customerName: string;
  /** Best-effort business context source — see lib/website.ts. Null/undefined is fine (just no context). */
  customerWebsite?: string | null;
  range: DateRange;
  reportTitle: string;
}

export async function generateEbrPptx(options: GenerateEbrPptxOptions): Promise<Buffer> {
  const { customerId, customerName, customerWebsite, range, reportTitle } = options;

  const shared = await computeSharedDeckData(customerId, range, customerWebsite ?? null);
  const [templateBuffer, { tokens, charts, usage, workflowSummary, periodLabel, fixups, notes, callouts }] = await Promise.all([
    readFile(TEMPLATE_PATH),
    buildEbrTokenData(customerId, customerName, customerWebsite ?? null, range, reportTitle, shared),
  ]);

  const zip = await JSZip.loadAsync(templateBuffer);

  const filePaths = Object.keys(zip.files);
  for (const filePath of filePaths) {
    const file = zip.file(filePath);
    if (!file || file.dir) continue;

    const chartKey = CHART_FILES[filePath];
    if (chartKey) {
      const xml = await file.async("string");
      zip.file(filePath, injectLineChartData(xml, charts[chartKey]));
      continue;
    }

    if (filePath.startsWith("ppt/slides/slide") && filePath.endsWith(".xml")) {
      let xml = await file.async("string");
      const original = xml;
      // Fix-ups first: they match the template's original run text, before tokens are filled.
      if (fixups[filePath]) xml = applyRunFixes(xml, fixups[filePath]);
      if (xml.includes("{{")) xml = replaceTokens(xml, tokens);
      if (xml !== original) zip.file(filePath, xml);
    }
  }

  // Speaker notes for every template slide (generated slides write their own as they're inserted);
  // the slide's ranked call-outs lead its CALL OUT section.
  for (const [slidePath, slideNotes] of Object.entries(notes)) {
    if (!zip.file(slidePath)) continue;
    const lines = (callouts[slidePath] ?? []).map(calloutLine);
    await setSlideNotes(zip, slidePath, { ...slideNotes, callouts: [...lines, ...(slideNotes.callouts ?? [])] });
  }

  // Business Performance Overview has empty space under its three cards: put its call-outs there.
  const panel = new ShapeWriter(900);
  panel.calloutPanel(791667, 4950000, 10608666, 1400000, callouts["ppt/slides/slide13.xml"] ?? []);
  if (panel.shapes.length) await appendShapesToSlide(zip, "ppt/slides/slide13.xml", panel);
  for (const list of Object.values(callouts)) collectCallouts(zip, list);

  // Generated (non-template) slides. Template charts are chart1–6; generated charts take the next free numbers.
  await insertUsageSlide(zip, usage, periodLabel);
  const automationSlidePath = await insertAutomationSlide(zip, workflowSummary, customerName, periodLabel);
  await insertModuleSlides(zip, { customerId, customerName, range, usage, workflowSummary, automationSlidePath, shared });

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buffer;
}
