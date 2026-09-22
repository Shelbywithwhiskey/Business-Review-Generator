// One-time preprocessing script: takes the original Roof Doctors EBR deck and
// replaces every customer-specific number/label with a {{TOKEN}} placeholder,
// producing templates/ebr-template.pptx. Run again only if the source deck's
// design changes and needs re-tokenizing.
//
// Token names here MUST match src/lib/pptx/ebrTokens.ts — that file supplies
// the runtime values substituted back in at export time.
//
// Usage: node scripts/tokenize-ebr-template.mjs <path-to-source-pptx>

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import JSZip from "jszip";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("Usage: node scripts/tokenize-ebr-template.mjs <path-to-source-pptx>");
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

async function tokenizeSlide(zip, slideFile, replacements) {
  const file = zip.file(slideFile);
  if (!file) throw new Error(`Missing ${slideFile}`);
  let content = await file.async("string");
  console.log(`\n${slideFile}`);
  for (const [old, token, label, opts] of replacements) {
    content = replaceAll(content, old, token, label ?? token, opts);
  }
  zip.file(slideFile, content);
}

async function main() {
  const buffer = await readFile(sourcePath);
  const zip = await JSZip.loadAsync(buffer);

  // ---- Slide 1: Title ----
  await tokenizeSlide(zip, "ppt/slides/slide1.xml", [
    ["Zuper &amp;  Roof Doctors Partnership", "Zuper &amp; {{CUSTOMER_NAME}} Partnership"],
    ["August 2026", "{{REPORT_DATE}}"],
    ["Executive Business Review", "{{REPORT_TITLE}}"],
  ]);

  // ---- Slide 19: Business Performance Overview ----
  await tokenizeSlide(zip, "ppt/slides/slide19.xml", [
    ["121,014", "{{JOBS_TOTAL}}"],
    ["16,261", "{{JOBS_COMPLETED}}"],
    ["13.44%", "{{JOBS_COMPLETION_RATE}}"],
    ["$85.74M", "{{QUOTES_TOTAL_VALUE}}"],
    ["Total Quotes – 23,132", "{{QUOTES_TOTAL_LABEL}}"],
    ["$9.74M", "{{QUOTES_ACCEPTED_VALUE}}"],
    ["Accepted – 4,092", "{{QUOTES_ACCEPTED_LABEL}}"],
    ["17.69%", "{{QUOTES_ACCEPTANCE_RATE}}"],
    ["$12.78M", "{{INVOICES_TOTAL_VALUE}}"],
    ["Total Invoices – 6,617", "{{INVOICES_TOTAL_LABEL}}"],
    ["$11.76M", "{{INVOICES_PAID_VALUE}}"],
    ["Paid – 6,253", "{{INVOICES_PAID_LABEL}}"],
    ["94.50%", "{{INVOICES_COLLECTION_RATE}}"],
  ]);

  // ---- Slide 20: Job Performance Overview ----
  await tokenizeSlide(zip, "ppt/slides/slide20.xml", [
    ["August 2025 – August 2026 ", "{{PERIOD_LABEL_S20}}"],
    ["·  Contracted Users: 32", "·  Active Users: {{ACTIVE_USERS}}"],
    // Must run before the individual-number replacements below — this sentence
    // shares literal numbers/names with the KPI cards, so tokenizing the cards
    // first would leave no intact copy of the full sentence to match here.
    [
      "3,902 jobs completed, led by Inspection Jobs at 48.2%, followed by Repair &amp; Replacement Bid Jobs at 8.0% and Opportunity &amp; other job types at 1.2%",
      "{{JOB_PERFORMANCE_INSIGHT}}",
    ],
    ["3,902", "{{JOBS_COMPLETED}}"],
    ["Inspection Jobs", "{{JOB_CAT1_NAME}}"],
    ["1,881", "{{JOB_CAT1_COUNT}}"],
    ["48.2% of all jobs", "{{JOB_CAT1_PCT}}% of all jobs"],
    ["Repair ", "{{JOB_CAT2_NAME}}"],
    ["&amp; Replacement Bid Jobs", ""], // note: non-breaking space after &amp; in this specific run
    ["311", "{{JOB_CAT2_COUNT}}"],
    ["8.0% of all jobs", "{{JOB_CAT2_PCT}}% of all jobs"],
    ["Opportunity &amp; others", "{{JOB_CAT3_NAME}}"],
    ["<a:t>48</a:t>", "<a:t>{{JOB_CAT3_COUNT}}</a:t>"],
    ["1.2% of all jobs", "{{JOB_CAT3_PCT}}% of all jobs"],
  ]);

  // ---- Slide 21: Zuper in Daily Operations (YTD footprint) ----
  await tokenizeSlide(zip, "ppt/slides/slide21.xml", [
    ["2026 YTD", "{{FOOTPRINT_CURRENT_LABEL}}"],
    ["$84.2M", "{{FOOTPRINT_QUOTE_VALUE}}"],
    ["$12.5M", "{{FOOTPRINT_INVOICE_VALUE}}"],
    ["90.9K", "{{FOOTPRINT_PROPERTIES}}"],
    ["<a:t>34</a:t>", "<a:t>{{FOOTPRINT_USER_IDENTITIES}}</a:t>"],
    ["January 2025 – December 2025", "{{FOOTPRINT_PRIOR_LABEL}}"],
    ["29,190", "{{FOOTPRINT_PRIOR_JOBS}}"],
    ["12,851", "{{FOOTPRINT_CURRENT_JOBS}}"],
    ["10,529", "{{FOOTPRINT_PRIOR_QUOTES}}"],
    ["5,314", "{{FOOTPRINT_CURRENT_QUOTES}}"],
    ["2,928", "{{FOOTPRINT_PRIOR_INVOICES}}"],
    ["3,140", "{{FOOTPRINT_CURRENT_INVOICES}}"],
  ]);

  // ---- Slide 22: Revenue & Quote Performance ----
  await tokenizeSlide(zip, "ppt/slides/slide22.xml", [
    ["August 2025 – August 2026  ·  Full year actuals from ", "{{PERIOD_LABEL_S22}}"],
    // Must run before "$32.27M" below — the insight sentence contains that
    // literal inline, so tokenizing the card first leaves nothing to match here.
    [
      "Collections hold steady at 90.4% across $6.47M invoiced — but $32.27M in quotes remains open, the single biggest lever for future revenue.",
      "{{Q22_INSIGHT_SENTENCE}}",
    ],
    ["$ 46.49M", "{{Q22_QUOTES_TOTAL_VALUE}}"],
    ["Total Quotes Created  - 10,525", "{{Q22_QUOTES_TOTAL_LABEL}}"],
    ["2,033 Accepted", "{{Q22_QUOTES_ACCEPTED_LABEL}}"],
    ["$5.05M", "{{Q22_QUOTES_ACCEPTED_VALUE}}"],
    ["18.1% acceptance rate", "{{Q22_QUOTES_ACCEPTANCE_RATE_LABEL}}"],
    ["1,104 Declined", "{{Q22_QUOTES_DECLINED_LABEL}}"],
    ["$2.17M", "{{Q22_QUOTES_DECLINED_VALUE}}"],
    ["8.8% decline rate", "{{Q22_QUOTES_DECLINE_RATE_LABEL}}"],
    ["6,695 Open / Pending", "{{Q22_QUOTES_OPEN_LABEL}}"],
    ["$32.27M", "{{Q22_QUOTES_OPEN_VALUE}}"],
    ["65.7% still in pipeline", "{{Q22_QUOTES_OPEN_PCT_LABEL}}"],
    ["693 Archived / Canceled", "{{Q22_QUOTES_ARCHIVED_LABEL}}"],
    ["$7.09M", "{{Q22_QUOTES_ARCHIVED_VALUE}}"],
    ["7.4% voided", "{{Q22_QUOTES_ARCHIVED_PCT_LABEL}}"],
    ["Total Invoices  - 4,304", "{{Q22_INVOICES_TOTAL_LABEL}}"],
    ["$ 7.16M", "{{Q22_INVOICES_TOTAL_VALUE}}"],
    ["4,080 Fully Paid", "{{Q22_INVOICES_FULLYPAID_LABEL}}"],
    ["$6.38M", "{{Q22_INVOICES_FULLYPAID_VALUE}}"],
    ["96.0% of invoices paid in full", "{{Q22_INVOICES_FULLYPAID_PCT_LABEL}}"],
    ["9 Partially Paid", "{{Q22_INVOICES_PARTIAL_LABEL}}"],
    ["$0.09M collected", "{{Q22_INVOICES_PARTIAL_COLLECTED_LABEL}}"],
    ["$0.01M still outstanding", "{{Q22_INVOICES_PARTIAL_OUTSTANDING_LABEL}}"],
    ["145 Open / Unpaid", "{{Q22_INVOICES_OPEN_LABEL}}"],
    ["$0.55M", "{{Q22_INVOICES_OPEN_VALUE}}"],
    [
      "$300K+ in open/unpaid invoices aged over 60 days (145 invoices).",
      "{{Q22_INVOICES_AGED60_SENTENCE}}",
    ],
    ["70 Archived / Canceled", "{{Q22_INVOICES_ARCHIVED_LABEL}}"],
    ["$0.14M", "{{Q22_INVOICES_ARCHIVED_VALUE}}"],
  ]);

  // ---- Slide 23: Quote Performance — Quarterly Breakdown (+ chart1, chart2) ----
  await tokenizeSlide(zip, "ppt/slides/slide23.xml", [
    [
      "August 2025 – August 2026  ·  Total quotes: 10,525  ·  $32.27M pipeline value",
      "{{PERIOD_LABEL_S23}}",
    ],
    [
      "Acceptance rate climbed from 15.9% in Q3 to a peak of 22.0% in Q1, before easing slightly to 21.6% in Q2. 6,695 quotes remain open, representing $32.27M in pipeline value.",
      "{{S23_INSIGHT}}",
    ],
    [
      "Prioritize follow-up on aging quotes, turn on automated quote reminders, and use text",
      "{{S23_RECOMMENDATION}}",
    ],
    ["reminders to lift acceptance on the open $32.27M pipeline.", ""],
    ["$46.49M", "{{S23_TOTAL_VALUE}}"],
    [" - 10,525", " - {{S23_TOTAL_COUNT}}"],
    ["$5.05M", "{{S23_ACCEPTED_VALUE}}"],
    [" - 2,033", " - {{S23_ACCEPTED_COUNT}}"],
    ["$2.17M", "{{S23_DECLINED_VALUE}}"],
    [" – 1,104", " – {{S23_DECLINED_COUNT}}"],
    ["<a:t>19.3</a:t>", "<a:t>{{S23_FULLYEAR_ACCEPTANCE_RATE}}</a:t>"],
  ]);

  // ---- Slide 24: Invoice & Collections — Quarterly Breakdown (+ chart3, chart4) ----
  await tokenizeSlide(zip, "ppt/slides/slide24.xml", [
    [
      "August 2025 – August 2026  ·  Total invoices: 4,304  ·  $7.16M invoiced  ·  $6.47M collected",
      "{{PERIOD_LABEL_S24}}",
    ],
    [
      "Collection rate peaked at 95.4% in Q3 before dipping to 82.6% in Q2 — the softest quarter. Invoiced value also declined steadily from $2.59M (Q3) to $0.92M (Q2), tracking the seasonal slowdown in job volume.",
      "{{S24_INSIGHT}}",
    ],
    ["<a:t>4,304</a:t>", "<a:t>{{S24_TOTAL_INVOICE_COUNT}}</a:t>"],
    ["<a:t>7.16M</a:t>", "<a:t>{{S24_TOTAL_VALUE}}M</a:t>"],
    ["$6.47M", "{{S24_COLLECTED_VALUE}}"],
    ["<a:t>90.4</a:t>", "<a:t>{{S24_FULLYEAR_COLLECTION_RATE}}</a:t>"],
  ]);

  // ---- Slide 25: Invoice & Quote Value — A Sharp Decline (+ chart5, chart6) ----
  await tokenizeSlide(zip, "ppt/slides/slide25.xml", [
    [
      "August 2025 – August 2026  ·  Monthly average invoice value &amp; unaccepted quote value",
      "{{PERIOD_LABEL_S25}}",
    ],
    [
      "Average invoice value fell 66% (Aug’25 $2,950 → Aug’26 $1,000) while unaccepted quote value fell 63% ($2.15M → $0.80M) over the same period — both show a sharp drop starting February 2026.",
      "{{S25_INSIGHT}}",
    ],
    ["-66%", "{{S25_AVG_INVOICE_DECLINE_PCT}}"],
    ["$2,950 → $1,000", "{{S25_AVG_INVOICE_RANGE}}"],
    ["-63%", "{{S25_QUOTE_VALUE_DECLINE_PCT}}"],
    ["$2.15M → $0.80M", "{{S25_QUOTE_VALUE_RANGE}}"],
    ["Avg Invoice Value (Aug’25 → Aug’26)", "{{S25_AVG_INVOICE_LABEL}}"],
    ["Unaccepted Quote Value (Aug’25 → Aug’26)", "{{S25_QUOTE_VALUE_LABEL}}"],
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
