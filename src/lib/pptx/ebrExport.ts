import { readFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import { buildEbrTokenData, computeSharedDeckData, type RunFix } from "./ebrTokens";
import { setSlideNotes } from "./slideNotes";
import { ShapeWriter, appendShapesToSlide, collectCallouts, collectedCallouts, insertGeneratedSlide, removeSlides } from "./generatedSlide";
import { calloutLine } from "@/lib/reports/callouts";
import { buildAccountBrief, type AccountBrief } from "@/lib/reports/accountBrief";
import { accountBriefSlide, lastSlidePath, referenceSlide } from "./briefSlide";
import { injectLineChartData } from "./chartData";
import { insertUsageSlide } from "./usageSlide";
import { insertAutomationSlide } from "./automationSlide";
import { insertModuleSlides } from "./moduleSlides";
import { improvementPicks, improvementsSlide } from "./insightSlides";
import type { Callout } from "@/lib/reports/callouts";

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "ebr-template.pptx");

/** The template was laid out from one sample customer's review; these pages carry that customer's own
 * timeline, delivered projects and placeholder figures, so they never go into a generated deck. The
 * data-driven journey slide (storySlides.ts) covers each account's own history instead. */
const SAMPLE_CUSTOMER_SLIDES = [
  "ppt/slides/slide11.xml", // Partnership Journey — sample customer's dated milestones
  "ppt/slides/slide26.xml", // What We've Built Together — sample customer's delivered projects
  "ppt/slides/slide29.xml", // Scaling Together — placeholder figures ("X users", "A data point")
];

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

/**
 * Recommended Priorities (slide 28) has four slots. Data-backed signals fill them first (ebrTokens);
 * any slot left over gets the account's next-most-material improvement call-out that isn't already
 * covered — and an empty slot only if the account has nothing more to improve.
 */
async function fillPriorities(zip: JSZip, tokens: Record<string, string>, deckCallouts: Callout[]) {
  const path = "ppt/slides/slide28.xml";
  const file = zip.file(path);
  if (!file) return;
  let xml = await file.async("string");
  if (!xml.includes("{{REC")) return;
  const used = [1, 2, 3, 4].map((n) => `${tokens[`REC${n}_TITLE`] ?? ""} ${tokens[`REC${n}_DESC`] ?? ""}`.toLowerCase()).join(" ");
  const covered = (c: Callout) => (c.headline.match(/\$?\d[\d,.]*[KM%]?/g) ?? []).some((num) => num.length >= 3 && used.includes(num.toLowerCase()));
  const extra = improvementPicks(deckCallouts, 10).filter((c) => !covered(c));
  const fill: Record<string, string> = {};
  for (const n of [1, 2, 3, 4]) {
    if (tokens[`REC${n}_TITLE`] != null) continue;
    const c = extra.shift();
    fill[`REC${n}_TITLE`] = c ? truncateWords(c.headline, 60) : "";
    fill[`REC${n}_DESC`] = c ? c.action ?? c.detail.replace(/^./, (s) => s.toUpperCase()) : "";
  }
  xml = replaceTokens(xml, fill);
  zip.file(path, xml);
}

function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,—–-]\s*$/, "").trimEnd()}…`;
}

export interface GenerateEbrPptxOptions {
  customerId: string;
  customerName: string;
  /** Best-effort business context source — see lib/website.ts. Null/undefined is fine (just no context). */
  customerWebsite?: string | null;
  /** The CSM's "About the company" notes — context for the Account Brief. */
  about?: string | null;
  /** Customer.testExclusions — what sync left out as test data. */
  testExclusions?: unknown;
  range: DateRange;
  reportTitle: string;
}

function briefPeriodLabel(range: DateRange): string {
  const f = (d: Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${f(range.start)} – ${f(range.end)}`;
}

export async function generateEbrPptx(options: GenerateEbrPptxOptions): Promise<{ buffer: Buffer; brief: AccountBrief }> {
  const { customerId, customerName, customerWebsite, range, reportTitle } = options;

  const shared = await computeSharedDeckData(customerId, range, customerWebsite ?? null);
  const [templateBuffer, { tokens, charts, usage, workflowSummary, periodLabel, fixups, notes, callouts, unusedSlides }] = await Promise.all([
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
  const modules = await insertModuleSlides(zip, { customerId, customerName, range, usage, workflowSummary, automationSlidePath, shared, reviewName: reportTitle });

  // Account Brief from every call-out in the deck, right after Highlights.
  const labels = (status: string) => modules.coverage.filter((c) => c.status === status).map((c) => c.label);
  const deckCallouts = collectedCallouts(zip);
  const brief = await buildAccountBrief({
    customerName,
    reviewName: reportTitle,
    periodLabel: briefPeriodLabel(range),
    yoy: shared.yoy,
    about: options.about ?? null,
    website: shared.website,
    industry: modules.industry,
    monthsOnZuper: modules.monthsOnZuper,
    callouts: deckCallouts,
    modules: { inUse: labels("ok"), noRecords: labels("empty"), notEnabled: labels("not_available") },
    testExclusions: options.testExclusions,
  });
  await insertGeneratedSlide(zip, modules.topCalloutsPath, accountBriefSlide(customerName, brief));
  // Every risk / watch item, kept off the customer-facing slides, on the very last slide.
  await insertGeneratedSlide(zip, await lastSlidePath(zip), referenceSlide(customerName, deckCallouts, brief));
  // The improvement agenda, right before the leadership working session and priorities (slides 27–28).
  const improvements = improvementsSlide(customerName, deckCallouts);
  if (improvements) await insertGeneratedSlide(zip, "ppt/slides/slide25.xml", improvements);
  await fillPriorities(zip, tokens, deckCallouts);
  // Last, so no later insert anchors on a removed slide: template pages for modules the account doesn't
  // use, and pages that only made sense for the sample customer the template was designed around.
  await removeSlides(zip, [...unusedSlides, ...SAMPLE_CUSTOMER_SLIDES]);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, brief };
}
