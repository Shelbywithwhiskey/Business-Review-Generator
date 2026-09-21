import Anthropic from "@anthropic-ai/sdk";
import type {
  PeriodMetrics,
  ComparisonResult,
  RuleMatch,
  HealthScoreResult,
  JobMetrics,
  InvoiceMetrics,
  TechnicianRanking,
} from "@/lib/analytics";

const SYSTEM_PROMPT = `You are writing content for a Zuper customer business review (QBR/MBR).
You will be given a JSON object of pre-computed metrics. Write only about numbers present in
that JSON, using them exactly as given — never calculate, round differently, or invent a number.
If a metric needed to support a claim isn't in the JSON, don't make the claim. Tone: confident,
concise, written for an account's stakeholders and the CSM team presenting it. No markdown, no
bullet points — plain prose paragraphs only.`;

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function client(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** Rejects output containing a number that doesn't appear anywhere in the input JSON (guards against invented figures). */
function validateNoInventedNumbers(text: string, inputJson: unknown): boolean {
  const inputStr = JSON.stringify(inputJson);
  const numbersInOutput = text.match(/\d[\d,]*\.?\d*/g) ?? [];
  for (const raw of numbersInOutput) {
    const n = raw.replace(/,/g, "");
    if (n.length <= 1) continue; // ignore stray single digits (e.g. "3 technicians" referencing a count elsewhere)
    if (!inputStr.includes(n)) return false;
  }
  return true;
}

async function generate(
  userPrompt: string,
  inputJson: unknown,
  fallback: () => string,
  maxTokens = 400
): Promise<string> {
  if (!aiEnabled()) return fallback();

  const anthropic = client();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${userPrompt}\n\nMetrics JSON:\n${JSON.stringify(inputJson, null, 2)}` }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (validateNoInventedNumbers(text, inputJson)) return text;
  }
  return fallback();
}

// ---------------------------------------------------------------------------
// Template fallbacks — used whenever ANTHROPIC_API_KEY isn't set. Every
// number here is read straight off the computed metrics, so the report is
// fully usable (just less polished prose) without any AI key at all.
// ---------------------------------------------------------------------------

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function templateExecutiveSummary(
  metrics: PeriodMetrics,
  comparison: ComparisonResult | undefined,
  health: HealthScoreResult
): string {
  const parts = [
    `The account completed ${metrics.jobs.completed} of ${metrics.jobs.total} jobs (${pct(metrics.jobs.completionRate)} completion rate) during the period, with ${money(metrics.invoices.totalPaid)} collected against ${money(metrics.invoices.totalAmount)} invoiced.`,
  ];
  if (comparison?.changePct.jobsCompleted != null) {
    const dir = comparison.changePct.jobsCompleted >= 0 ? "up" : "down";
    parts.push(`Completed jobs were ${dir} ${pct(Math.abs(comparison.changePct.jobsCompleted))} versus the previous period.`);
  }
  parts.push(`Overall account health is ${health.overall}/100.`);
  return parts.join(" ");
}

function templateJobsNarrative(m: JobMetrics): string {
  return `The account logged ${m.total} jobs, of which ${m.completed} were completed (${pct(m.completionRate)}) and ${m.cancelled} were cancelled (${pct(m.cancellationRate)}). Total job value across the period was ${money(m.totalJobValue)}.`;
}

function templateInvoiceNarrative(m: InvoiceMetrics): string {
  return `${m.total} invoices were issued totaling ${money(m.totalAmount)}, with ${money(m.totalPaid)} collected and ${money(m.outstanding)} outstanding. Average invoice value was ${money(m.avgInvoiceValue)}.`;
}

function templateTechnicianNarrative(rankings: TechnicianRanking[]): string {
  if (rankings.length === 0) return "No technician data is available for this period.";
  const top = rankings.slice(0, 3);
  const list = top.map((t) => `${t.name} (${t.jobsCompleted} jobs, ${money(t.revenue)} revenue)`).join(", ");
  return `${rankings.length} technicians were active this period. Top performers: ${list}.`;
}

function templateOpportunitiesNarrative(rules: RuleMatch[]): string {
  if (rules.length === 0) return "No notable opportunities or risks were flagged for this period.";
  return `${rules.length} item(s) were flagged for review this period: ${rules.map((r) => r.detail).join(" ")}`;
}

const RECOMMENDATION_TEMPLATES: Record<string, (rule: RuleMatch) => string> = {
  cancellation_rate_increase: (r) =>
    `Recommendation: ${r.detail} Review cancellation reasons and whether scheduling capacity or technician assignment is contributing.`,
  invoice_aging_high: (r) => `Recommendation: ${r.detail} Consider automated payment reminders for accounts aged beyond 60 days.`,
  technician_workload_concentration: (r) =>
    `Recommendation: ${r.detail} Review workload distribution to determine whether additional technicians need onboarding or assignments can be rebalanced.`,
  zuper_pay_opportunity: (r) =>
    `Recommendation: ${r.detail} This is a strong candidate for enabling Zuper Pay to consolidate payment processing.`,
};

function templateRecommendation(rule: RuleMatch): string {
  const fn = RECOMMENDATION_TEMPLATES[rule.key];
  return fn ? fn(rule) : `Recommendation: ${rule.detail}`;
}

// ---------------------------------------------------------------------------
// Public API — same signatures whether or not AI is configured.
// ---------------------------------------------------------------------------

export async function generateExecutiveSummary(
  metrics: PeriodMetrics,
  comparison: ComparisonResult | undefined,
  health: HealthScoreResult
): Promise<string> {
  return generate(
    "Write a 3-5 sentence executive summary of this account's performance for the period, referencing the health score and any period-over-period change.",
    { metrics, comparison: comparison?.changePct, health },
    () => templateExecutiveSummary(metrics, comparison, health),
    500
  );
}

export async function generateSectionNarrative(sectionKey: string, sectionMetrics: unknown): Promise<string> {
  const fallback = () => {
    switch (sectionKey) {
      case "jobs_performance":
        return templateJobsNarrative(sectionMetrics as JobMetrics);
      case "invoice_performance":
        return templateInvoiceNarrative(sectionMetrics as InvoiceMetrics);
      case "technician_performance":
        return templateTechnicianNarrative(sectionMetrics as TechnicianRanking[]);
      case "opportunities":
        return templateOpportunitiesNarrative(sectionMetrics as RuleMatch[]);
      default:
        return "No narrative available for this section.";
    }
  };
  return generate(
    `Write one short narrative paragraph (2-4 sentences) for the "${sectionKey}" section of this report.`,
    sectionMetrics,
    fallback
  );
}

export async function generateRecommendation(sectionKey: string, rule: RuleMatch): Promise<string> {
  return generate(
    `Write a 1-2 sentence actionable recommendation for the "${sectionKey}" section, based on this specific issue detected by the rules engine. Start with "Recommendation:".`,
    { rule },
    () => templateRecommendation(rule)
  );
}
