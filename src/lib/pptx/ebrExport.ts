import { readFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import type { DateRange } from "@/lib/zuper/modules";
import { buildEbrTokenData } from "./ebrTokens";
import { injectLineChartData } from "./chartData";
import { insertUsageSlide } from "./usageSlide";
import { insertAutomationSlide } from "./automationSlide";

const TEMPLATE_PATH = path.join(process.cwd(), "templates", "ebr-template.pptx");

const CHART_FILES: Record<string, keyof Awaited<ReturnType<typeof buildEbrTokenData>>["charts"]> = {
  "ppt/charts/chart1.xml": "chart1",
  "ppt/charts/chart2.xml": "chart2",
  "ppt/charts/chart3.xml": "chart3",
  "ppt/charts/chart4.xml": "chart4",
  "ppt/charts/chart5.xml": "chart5",
  "ppt/charts/chart6.xml": "chart6",
};

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

  const [templateBuffer, { tokens, charts, usage, workflowSummary, periodLabel }] = await Promise.all([
    readFile(TEMPLATE_PATH),
    buildEbrTokenData(customerId, customerName, customerWebsite ?? null, range, reportTitle),
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
      const xml = await file.async("string");
      if (xml.includes("{{")) {
        zip.file(filePath, replaceTokens(xml, tokens));
      }
    }
  }

  await insertUsageSlide(zip, usage, periodLabel);
  await insertAutomationSlide(zip, workflowSummary, customerName, periodLabel);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buffer;
}
