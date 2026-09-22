// One-time preprocessing script for the new 29-slide "Template for QBR.pptx"
// (replaces the earlier 45-slide Roof Doctors EBR deck as the master template —
// same output path, templates/ebr-template.pptx, so the export pipeline needs
// no changes). Token names MUST match src/lib/pptx/ebrTokens.ts.
//
// New in this version: slide21 (Platform Performance) ships with EMPTY value
// placeholders (no literal text to replace), so insertRunAfterShapeId() finds
// the shape by its unique <p:cNvPr id="N"> anchor and inserts a new <a:r> run
// before that shape's next <a:endParaRPr>, instead of replacing existing text.
//
// Usage: node scripts/tokenize-qbr-template.mjs <path-to-source-pptx>

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import JSZip from "jszip";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/tokenize-qbr-template.mjs <path-to-source-pptx>");
  process.exit(1);
}

const OUT_PATH = path.join(process.cwd(), "templates", "ebr-template.pptx");

function replaceAll(content, old, token, label, { optional = false } = {}) {
  const count = content.split(old).length - 1;
  if (count === 0) {
    if (optional) {
      console.warn(`  (skip, not found) ${label}`);
      return content;
    }
    throw new Error(`Tokenize: literal not found for "${label}":\n${JSON.stringify(old)}`);
  }
  console.log(`  [${count}x] ${label}`);
  return content.split(old).join(token);
}

/** Inserts <a:r>{rPrXml}<a:t>token</a:t></a:r> right before the next
 * <a:endParaRPr ...> (or .../>) that follows the shape's <p:cNvPr id="shapeId"> anchor.
 * rPrXml must be a complete, self-contained <a:rPr .../> or <a:rPr>...</a:rPr> element. */
function insertRunAfterShapeId(content, shapeId, token, rPrXml, label) {
  const anchor = `<p:cNvPr id="${shapeId}" `;
  const anchorIdx = content.indexOf(anchor);
  if (anchorIdx === -1) throw new Error(`insertRunAfterShapeId: shape id="${shapeId}" not found (${label})`);

  const endParaIdx = content.indexOf("<a:endParaRPr", anchorIdx);
  if (endParaIdx === -1) throw new Error(`insertRunAfterShapeId: no <a:endParaRPr> after shape id="${shapeId}" (${label})`);

  const run = `<a:r>${rPrXml}<a:t>${token}</a:t></a:r>`;
  console.log(`  [insert] shape id=${shapeId}: ${label}`);
  return content.slice(0, endParaIdx) + run + content.slice(endParaIdx);
}

/** Inserts a new sibling run immediately after the <a:r> run whose full text is
 * exactly `marker` (matched as `>marker</a:t></a:r>` so the insertion point sits
 * between the closing run tags, never inside the existing text node). rPrXml
 * must be a complete, self-contained <a:rPr .../> or <a:rPr>...</a:rPr> element. */
function insertRunBeforeText(content, marker, token, rPrXml, label) {
  const closePattern = `>${marker}</a:t></a:r>`;
  const count = content.split(closePattern).length - 1;
  if (count !== 1) throw new Error(`insertRunBeforeText: expected exactly 1 occurrence of ${JSON.stringify(closePattern)} for "${label}", found ${count}`);
  const idx = content.indexOf(closePattern) + closePattern.length;
  const run = `<a:r>${rPrXml}<a:t> ${token}</a:t></a:r>`;
  console.log(`  [insert-after-text] ${label}`);
  return content.slice(0, idx) + run + content.slice(idx);
}

async function tokenizeSlide(zip, slideFile, ops) {
  const file = zip.file(slideFile);
  if (!file) throw new Error(`Missing ${slideFile}`);
  let content = await file.async("string");
  console.log(`\n${slideFile}`);
  for (const op of ops) {
    if (op.kind === "replace") {
      content = replaceAll(content, op.old, op.token, op.label ?? op.token, op.opts);
    } else if (op.kind === "insertAfterShape") {
      content = insertRunAfterShapeId(content, op.shapeId, op.token, op.rPrXml, op.label);
    } else if (op.kind === "insertAfterText") {
      content = insertRunBeforeText(content, op.marker, op.token, op.rPrXml, op.label);
    }
  }
  zip.file(slideFile, content);
}

// Shared run styles matching the deck's existing "big number" and "muted label" conventions.
// Each is a COMPLETE, self-contained <a:rPr>...</a:rPr> element (not a fragment) —
// insertRunAfterShapeId/insertRunBeforeText splice these in verbatim before <a:t>.
const BIG_ORANGE =
  '<a:rPr lang="en-US" sz="2375" b="1"><a:solidFill><a:srgbClr val="FD5000"/></a:solidFill><a:latin typeface="Aptos Display"/></a:rPr>';
const MUTED_NA =
  '<a:rPr lang="en-US" sz="1200"><a:solidFill><a:srgbClr val="7A7268"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr>';
const ATTACHMENTS_VALUE =
  '<a:rPr lang="en-US" sz="1667" b="1"><a:solidFill><a:srgbClr val="B5271C"/></a:solidFill><a:latin typeface="Aptos Display"/></a:rPr>';
const ACTIVE_CONTRACTED_VALUE =
  '<a:rPr lang="en-US" sz="1167" b="1"><a:solidFill><a:srgbClr val="B4473E"/></a:solidFill><a:latin typeface="Aptos Display"/></a:rPr>';

async function main() {
  const buffer = await readFile(sourcePath);
  const zip = await JSZip.loadAsync(buffer);

  // ---- Slide 1: Title ----
  await tokenizeSlide(zip, "ppt/slides/slide1.xml", [
    { kind: "replace", old: "Zuper &amp;  ( Company Name ) Partnership", token: "Zuper &amp; {{CUSTOMER_NAME}} Partnership" },
    { kind: "replace", old: "FY 2026", token: "{{REPORT_DATE}}" },
    { kind: "replace", old: "Executive Business Review", token: "{{REPORT_TITLE}}" },
  ]);

  // ---- Slide 13: Business Performance Overview (= old slide19) ----
  await tokenizeSlide(zip, "ppt/slides/slide13.xml", [
    { kind: "replace", old: "121,014", token: "{{JOBS_TOTAL}}" },
    { kind: "replace", old: "16,261", token: "{{JOBS_COMPLETED}}" },
    { kind: "replace", old: "13.44%", token: "{{JOBS_COMPLETION_RATE}}" },
    { kind: "replace", old: "$85.74M", token: "{{QUOTES_TOTAL_VALUE}}" },
    { kind: "replace", old: "Total Quotes – 23,132", token: "{{QUOTES_TOTAL_LABEL}}" },
    { kind: "replace", old: "$9.74M", token: "{{QUOTES_ACCEPTED_VALUE}}" },
    { kind: "replace", old: "Accepted – 4,092", token: "{{QUOTES_ACCEPTED_LABEL}}" },
    { kind: "replace", old: "17.69%", token: "{{QUOTES_ACCEPTANCE_RATE}}" },
    { kind: "replace", old: "$12.78M", token: "{{INVOICES_TOTAL_VALUE}}" },
    { kind: "replace", old: "Total Invoices – 6,617", token: "{{INVOICES_TOTAL_LABEL}}" },
    { kind: "replace", old: "$11.76M", token: "{{INVOICES_PAID_VALUE}}" },
    { kind: "replace", old: "Paid – 6,253", token: "{{INVOICES_PAID_LABEL}}" },
    { kind: "replace", old: "94.50%", token: "{{INVOICES_COLLECTION_RATE}}" },
  ]);

  // ---- Slide 14: Job Performance Overview (= old slide20) ----
  await tokenizeSlide(zip, "ppt/slides/slide14.xml", [
    {
      kind: "replace",
      old: "3,902 jobs completed, led by Inspection Jobs at 48.2%, followed by Repair &amp; Replacement Bid Jobs at 8.0% and Opportunity &amp; other job types at 1.2%",
      token: "{{JOB_PERFORMANCE_INSIGHT}}",
    },
    { kind: "replace", old: "August 2025 – August 2026 ·  Contracted Users: 32", token: "{{PERIOD_LABEL_S20}} ·  Active Users: {{ACTIVE_USERS}}" },
    { kind: "replace", old: "3,902", token: "{{JOBS_COMPLETED}}" },
    { kind: "replace", old: "Inspection Jobs", token: "{{JOB_CAT1_NAME}}" },
    { kind: "replace", old: "1,881", token: "{{JOB_CAT1_COUNT}}" },
    { kind: "replace", old: "48.2% of all jobs", token: "{{JOB_CAT1_PCT}}% of all jobs" },
    // Combined into one run in this template (unlike the old deck's 2-run split); non-breaking space after &amp;.
    { kind: "replace", old: "<a:t>Repair &amp; Replacement Bid Jobs</a:t>", token: "<a:t>{{JOB_CAT2_NAME}}</a:t>" },
    // Anchored with tags — bare "311" also matches inside coordinate attributes (e.g. y="3931135") in this deck.
    { kind: "replace", old: "<a:t>311</a:t>", token: "<a:t>{{JOB_CAT2_COUNT}}</a:t>" },
    { kind: "replace", old: "8.0% of all jobs", token: "{{JOB_CAT2_PCT}}% of all jobs" },
    { kind: "replace", old: "Opportunity &amp; others", token: "{{JOB_CAT3_NAME}}" },
    { kind: "replace", old: "<a:t>48</a:t>", token: "<a:t>{{JOB_CAT3_COUNT}}</a:t>" },
    { kind: "replace", old: "1.2% of all jobs", token: "{{JOB_CAT3_PCT}}% of all jobs" },
  ]);

  // ---- Slide 15: Zuper in Daily Operations / YTD footprint (= old slide21) ----
  await tokenizeSlide(zip, "ppt/slides/slide15.xml", [
    { kind: "replace", old: "Zuper + Roof Doctors", token: "Zuper + {{CUSTOMER_NAME}}" },
    { kind: "replace", old: "Roof Doctors&#8217; property", token: "{{CUSTOMER_NAME}}&#8217;s property", opts: { optional: true } },
    { kind: "replace", old: "Roof Doctors’ property", token: "{{CUSTOMER_NAME}}’s property", opts: { optional: true } },
    { kind: "replace", old: "Roof Doctors' property", token: "{{CUSTOMER_NAME}}'s property", opts: { optional: true } },
    { kind: "replace", old: "2026 YTD", token: "{{FOOTPRINT_CURRENT_LABEL}}" },
    { kind: "replace", old: "$84.2M", token: "{{FOOTPRINT_QUOTE_VALUE}}" },
    { kind: "replace", old: "$12.5M", token: "{{FOOTPRINT_INVOICE_VALUE}}" },
    { kind: "replace", old: "90.9K", token: "{{FOOTPRINT_PROPERTIES}}" },
    { kind: "replace", old: "<a:t>34</a:t>", token: "<a:t>{{FOOTPRINT_USER_IDENTITIES}}</a:t>" },
    { kind: "replace", old: "January 2025 – December 2025", token: "{{FOOTPRINT_PRIOR_LABEL}}" },
    { kind: "replace", old: "29,190", token: "{{FOOTPRINT_PRIOR_JOBS}}" },
    { kind: "replace", old: "12,851", token: "{{FOOTPRINT_CURRENT_JOBS}}" },
    { kind: "replace", old: "10,529", token: "{{FOOTPRINT_PRIOR_QUOTES}}" },
    { kind: "replace", old: "5,314", token: "{{FOOTPRINT_CURRENT_QUOTES}}" },
    { kind: "replace", old: "2,928", token: "{{FOOTPRINT_PRIOR_INVOICES}}" },
    { kind: "replace", old: "3,140", token: "{{FOOTPRINT_CURRENT_INVOICES}}" },
  ]);

  // ---- Slide 16: Revenue & Quote Performance (= old slide22) ----
  await tokenizeSlide(zip, "ppt/slides/slide16.xml", [
    {
      kind: "replace",
      old: "Collections hold steady at 90.4% across $6.47M invoiced — but $32.27M in quotes remains open, the single biggest lever for future revenue.",
      token: "{{Q22_INSIGHT_SENTENCE}}",
    },
    { kind: "replace", old: "August 2025 – August 2026  ·  Full year actuals from ", token: "{{PERIOD_LABEL_S22}}" },
    { kind: "replace", old: "$ 46.49M", token: "{{Q22_QUOTES_TOTAL_VALUE}}" },
    { kind: "replace", old: "Total Quotes Created  - 10,525", token: "{{Q22_QUOTES_TOTAL_LABEL}}" },
    { kind: "replace", old: "2,033 Accepted", token: "{{Q22_QUOTES_ACCEPTED_LABEL}}" },
    { kind: "replace", old: "$5.05M", token: "{{Q22_QUOTES_ACCEPTED_VALUE}}" },
    { kind: "replace", old: "18.1% acceptance rate", token: "{{Q22_QUOTES_ACCEPTANCE_RATE_LABEL}}" },
    { kind: "replace", old: "1,104 Declined", token: "{{Q22_QUOTES_DECLINED_LABEL}}" },
    { kind: "replace", old: "$2.17M", token: "{{Q22_QUOTES_DECLINED_VALUE}}" },
    { kind: "replace", old: "8.8% decline rate", token: "{{Q22_QUOTES_DECLINE_RATE_LABEL}}" },
    { kind: "replace", old: "6,695 Open / Pending", token: "{{Q22_QUOTES_OPEN_LABEL}}" },
    { kind: "replace", old: "$32.27M", token: "{{Q22_QUOTES_OPEN_VALUE}}" },
    { kind: "replace", old: "65.7% still in pipeline", token: "{{Q22_QUOTES_OPEN_PCT_LABEL}}" },
    { kind: "replace", old: "693 Archived / Canceled", token: "{{Q22_QUOTES_ARCHIVED_LABEL}}" },
    { kind: "replace", old: "$7.09M", token: "{{Q22_QUOTES_ARCHIVED_VALUE}}" },
    { kind: "replace", old: "7.4% voided", token: "{{Q22_QUOTES_ARCHIVED_PCT_LABEL}}" },
    { kind: "replace", old: "Total Invoices  - 4,304", token: "{{Q22_INVOICES_TOTAL_LABEL}}" },
    { kind: "replace", old: "$ 7.16M", token: "{{Q22_INVOICES_TOTAL_VALUE}}" },
    { kind: "replace", old: "4,080 Fully Paid", token: "{{Q22_INVOICES_FULLYPAID_LABEL}}" },
    { kind: "replace", old: "$6.38M", token: "{{Q22_INVOICES_FULLYPAID_VALUE}}" },
    { kind: "replace", old: "96.0% of invoices paid in full", token: "{{Q22_INVOICES_FULLYPAID_PCT_LABEL}}" },
    { kind: "replace", old: "9 Partially Paid", token: "{{Q22_INVOICES_PARTIAL_LABEL}}" },
    { kind: "replace", old: "$0.09M collected", token: "{{Q22_INVOICES_PARTIAL_COLLECTED_LABEL}}" },
    { kind: "replace", old: "$0.01M still outstanding", token: "{{Q22_INVOICES_PARTIAL_OUTSTANDING_LABEL}}" },
    { kind: "replace", old: "145 Open / Unpaid", token: "{{Q22_INVOICES_OPEN_LABEL}}" },
    { kind: "replace", old: "$0.55M", token: "{{Q22_INVOICES_OPEN_VALUE}}" },
    { kind: "replace", old: "$300K+ in open/unpaid invoices aged over 60 days (145 invoices).", token: "{{Q22_INVOICES_AGED60_SENTENCE}}" },
    { kind: "replace", old: "70 Archived / Canceled", token: "{{Q22_INVOICES_ARCHIVED_LABEL}}" },
    { kind: "replace", old: "$0.14M", token: "{{Q22_INVOICES_ARCHIVED_VALUE}}" },
  ]);

  // ---- Slide 17: Quote Performance — Quarterly Breakdown (= old slide23, chart1+2) ----
  await tokenizeSlide(zip, "ppt/slides/slide17.xml", [
    { kind: "replace", old: "August 2025 – August 2026  ·  Total quotes: 10,525  ·  $32.27M pipeline value", token: "{{PERIOD_LABEL_S23}}" },
    {
      kind: "replace",
      old: "Acceptance rate climbed from 15.9% in Q3 to a peak of 22.0% in Q1, before easing slightly to 21.6% in Q2. 6,695 quotes remain open, representing $32.27M in pipeline value.",
      token: "{{S23_INSIGHT}}",
    },
    { kind: "replace", old: "Prioritize follow-up on aging quotes, turn on automated quote reminders, and use text", token: "{{S23_RECOMMENDATION}}" },
    { kind: "replace", old: "reminders to lift acceptance on the open $32.27M pipeline.", token: "" },
    { kind: "replace", old: "$46.49M", token: "{{S23_TOTAL_VALUE}}" },
    { kind: "replace", old: " - 10,525", token: " - {{S23_TOTAL_COUNT}}", opts: { optional: true } },
    { kind: "replace", old: " - 10,525", token: " - {{S23_TOTAL_COUNT}}", opts: { optional: true } },
    { kind: "replace", old: "$5.05M", token: "{{S23_ACCEPTED_VALUE}}" },
    { kind: "replace", old: " - 2,033", token: " - {{S23_ACCEPTED_COUNT}}", opts: { optional: true } },
    { kind: "replace", old: " - 2,033", token: " - {{S23_ACCEPTED_COUNT}}", opts: { optional: true } },
    { kind: "replace", old: "$2.17M", token: "{{S23_DECLINED_VALUE}}" },
    { kind: "replace", old: " – 1,104", token: " – {{S23_DECLINED_COUNT}}" },
    { kind: "replace", old: "<a:t>19.3</a:t>", token: "<a:t>{{S23_FULLYEAR_ACCEPTANCE_RATE}}</a:t>" },
  ]);

  // ---- Slide 18: Invoice & Collections — Quarterly Breakdown (= old slide24, chart3+4) ----
  await tokenizeSlide(zip, "ppt/slides/slide18.xml", [
    { kind: "replace", old: "August 2025 – August 2026  ·  Total invoices: 4,304  ·  $7.16M invoiced  ·  $6.47M collected", token: "{{PERIOD_LABEL_S24}}", opts: { optional: true } },
    { kind: "replace", old: "August 2025 – August 2026  ·  Total invoices: 4,304  ·  $7.16M invoiced  ·  $6.47M collected", token: "{{PERIOD_LABEL_S24}}", opts: { optional: true } },
    {
      kind: "replace",
      old: "Collection rate peaked at 95.4% in Q3 before dipping to 82.6% in Q2 — the softest quarter. Invoiced value also declined steadily from $2.59M (Q3) to $0.92M (Q2), tracking the seasonal slowdown in job volume.",
      token: "{{S24_INSIGHT}}",
    },
    { kind: "replace", old: "<a:t>4,304</a:t>", token: "<a:t>{{S24_TOTAL_INVOICE_COUNT}}</a:t>" },
    { kind: "replace", old: "<a:t>7.16M</a:t>", token: "<a:t>{{S24_TOTAL_VALUE}}M</a:t>" },
    { kind: "replace", old: "$6.47M", token: "{{S24_COLLECTED_VALUE}}" },
    { kind: "replace", old: "<a:t>90.4</a:t>", token: "<a:t>{{S24_FULLYEAR_COLLECTION_RATE}}</a:t>" },
  ]);

  // ---- Slide 19: Invoice & Quote Value — A Sharp Decline (= old slide25, chart5+6) ----
  await tokenizeSlide(zip, "ppt/slides/slide19.xml", [
    { kind: "replace", old: "August 2025 – August 2026  ·  Monthly average invoice value &amp; unaccepted quote value", token: "{{PERIOD_LABEL_S25}}" },
    {
      kind: "replace",
      old: "Average invoice value fell 66% (Aug’25 $2,950 → Aug’26 $1,000) while unaccepted quote value fell 63% ($2.15M → $0.80M) over the same period — both show a sharp drop starting February 2026.",
      token: "{{S25_INSIGHT}}",
    },
    { kind: "replace", old: "-66%", token: "{{S25_AVG_INVOICE_DECLINE_PCT}}" },
    { kind: "replace", old: "$2,950 → $1,000", token: "{{S25_AVG_INVOICE_RANGE}}" },
    { kind: "replace", old: "-63%", token: "{{S25_QUOTE_VALUE_DECLINE_PCT}}" },
    { kind: "replace", old: "$2.15M → $0.80M", token: "{{S25_QUOTE_VALUE_RANGE}}" },
    { kind: "replace", old: "Avg Invoice Value (Aug’25 → Aug’26)", token: "{{S25_AVG_INVOICE_LABEL}}" },
    { kind: "replace", old: "Unaccepted Quote Value (Aug’25 → Aug’26)", token: "{{S25_QUOTE_VALUE_LABEL}}" },
  ]);

  // ---- Slide 21: Platform Performance ----
  // Value placeholders ship empty in this template — insert new runs rather than replace text.
  // Shape ids from the source XML (see slide21.xml dump): 9/11=API calls/P95 (not derivable),
  // 15=Attachments (not derivable), 19=Active Workflows, 21=Runs (not derivable),
  // 25=Success rate "%" run (not derivable), 29=Jobs Created, 31=Invoice value,
  // 35="Active users:\nContracted users:" two-line label (append after each line).
  await tokenizeSlide(zip, "ppt/slides/slide21.xml", [
    { kind: "insertAfterShape", shapeId: 9, token: "N/A", rPrXml: MUTED_NA, label: "API Calls/month (not exposed by API)" },
    { kind: "insertAfterShape", shapeId: 11, token: "N/A", rPrXml: MUTED_NA, label: "P95 Response time (not exposed by API)" },
    { kind: "insertAfterShape", shapeId: 15, token: "N/A", rPrXml: ATTACHMENTS_VALUE, label: "Attachments & Files stored (not exposed by API)" },
    { kind: "insertAfterShape", shapeId: 19, token: "{{WF_ACTIVE_OF_TOTAL}}", rPrXml: BIG_ORANGE, label: "Active Workflows" },
    { kind: "insertAfterShape", shapeId: 21, token: "N/A", rPrXml: MUTED_NA, label: "Runs - last 3 months (not exposed by API)" },
    // Success rate: replace the existing lone "%" run's text entirely (no run to insert before).
    { kind: "replace", old: "<a:t>%</a:t></a:r><a:endParaRPr lang=\"en-US\" sz=\"1667\" dirty=\"0\">", token: "<a:t>N/A</a:t></a:r><a:endParaRPr lang=\"en-US\" sz=\"1667\" dirty=\"0\">", label: "Success rate (not exposed by API)" },
    { kind: "insertAfterShape", shapeId: 29, token: "{{WF_JOBS_CREATED}}", rPrXml: BIG_ORANGE, label: "Jobs Created" },
    { kind: "insertAfterShape", shapeId: 31, token: "{{WF_INVOICE_VALUE}}", rPrXml: BIG_ORANGE, label: "Invoice value" },
    { kind: "insertAfterText", marker: "Active users:", token: "{{WF_ACTIVE_USERS}}", rPrXml: ACTIVE_CONTRACTED_VALUE, label: "Active users value" },
    { kind: "insertAfterText", marker: "Contracted users:", token: "N/A", rPrXml: ACTIVE_CONTRACTED_VALUE, label: "Contracted users (not exposed by API)" },
  ]);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  const outBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(OUT_PATH, outBuffer);
  console.log(`\nWrote ${OUT_PATH} (${(outBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error("\nTOKENIZE FAILED:", err.message);
  process.exit(1);
});
