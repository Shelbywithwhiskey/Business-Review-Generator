import Anthropic from "@anthropic-ai/sdk";
import type {
  PeriodMetrics,
  ComparisonResult,
  RuleMatch,
  HealthScoreResult,
  JobMetrics,
  InvoiceMetrics,
  QuoteMetrics,
  TechnicianRanking,
  KeyInsights,
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
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

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
  const onTime = m.onTimePaymentRate != null ? ` On-time payment rate was ${pct(m.onTimePaymentRate)}.` : "";
  return `${m.total} invoices were issued totaling ${money(m.totalAmount)}, with ${money(m.totalPaid)} collected and ${money(m.outstanding)} outstanding.${onTime} Average invoice value was ${money(m.avgInvoiceValue)}.`;
}

function templateQuoteNarrative(m: QuoteMetrics): string {
  if (m.total === 0) return "No quotes were sent during this period.";
  return `${m.total} quotes were sent totaling ${money(m.totalValue)}, of which ${m.convertedCount} converted (${pct(m.conversionRate)} conversion rate) worth ${money(m.convertedValue)}. Average quote value was ${money(m.avgQuoteValue)}.`;
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

function templateKeyInsightsNarrative(insights: KeyInsights): string {
  const parts: string[] = [];

  if (insights.powerTechnician) {
    const t = insights.powerTechnician;
    parts.push(
      `${t.name} was the account's top performer this period, generating ${money(t.revenue)} (${pct(t.sharePctOfRevenue)} of total technician revenue).`
    );
  }
  if (insights.topServiceTypeByRevenue) {
    parts.push(
      `${insights.topServiceTypeByRevenue.type} was the highest-revenue service type at ${money(insights.topServiceTypeByRevenue.revenue)}.`
    );
  }
  if (insights.avgDaysToPay != null) {
    parts.push(`Invoices paid this period took an average of ${insights.avgDaysToPay.toFixed(1)} days to collect.`);
  }
  if (insights.avgDaysQuoteToClose != null) {
    parts.push(`Converted quotes closed in an average of ${insights.avgDaysQuoteToClose.toFixed(1)} days from being sent.`);
  }
  parts.push(
    `${pct(insights.repeatCustomerRate)} of the account's customers have placed more than one job, and the top 5 customers represent ${pct(insights.revenueConcentrationTop5Pct)} of total account lifetime value.`
  );
  if (insights.dormantSeats.length > 0) {
    parts.push(
      `${insights.dormantSeats.length} licensed seat(s) show no login activity this period: ${insights.dormantSeats.map((s) => s.name).join(", ")}.`
    );
  }
  if (insights.highValueCustomersInactiveThisPeriod.length > 0) {
    parts.push(
      `${insights.highValueCustomersInactiveThisPeriod.length} of the top 10 lifetime-value customers had no jobs this period: ${insights.highValueCustomersInactiveThisPeriod.map((c) => c.name).join(", ")}.`
    );
  }

  return parts.length ? parts.join(" ") : "No standout patterns were detected in this period's data.";
}

const RECOMMENDATION_TEMPLATES: Record<string, (rule: RuleMatch) => string> = {
  cancellation_rate_increase: (r) =>
    `Recommendation: ${r.detail} Review cancellation reasons and whether scheduling capacity or technician assignment is contributing.`,
  invoice_aging_high: (r) => `Recommendation: ${r.detail} Consider automated payment reminders for accounts aged beyond 60 days.`,
  technician_workload_concentration: (r) =>
    `Recommendation: ${r.detail} Review workload distribution to determine whether additional technicians need onboarding or assignments can be rebalanced.`,
  zuper_pay_opportunity: (r) =>
    `Recommendation: ${r.detail} This is a strong candidate for enabling Zuper Pay to consolidate payment processing.`,
  quote_conversion_low: (r) =>
    `Recommendation: ${r.detail} Review quote follow-up cadence and pricing competitiveness for quotes that stalled or expired.`,
  inventory_low_stock: (r) =>
    `Recommendation: ${r.detail} Reorder affected parts to avoid job delays from stockouts.`,
  dormant_licensed_seats: (r) =>
    `Recommendation: ${r.detail} Confirm these seats are still needed at renewal, or schedule a refresher training to drive adoption.`,
  high_value_customer_churn_risk: (r) =>
    `Recommendation: ${r.detail} Proactively reach out to these accounts before renewal to confirm satisfaction and re-engage.`,
  customer_concentration_risk: (r) =>
    `Recommendation: ${r.detail} Diversifying the customer base would reduce exposure if any single top account churns.`,
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
      case "quotes_performance":
        return templateQuoteNarrative(sectionMetrics as QuoteMetrics);
      case "technician_performance":
        return templateTechnicianNarrative(sectionMetrics as TechnicianRanking[]);
      case "opportunities":
        return templateOpportunitiesNarrative(sectionMetrics as RuleMatch[]);
      case "key_insights":
        return templateKeyInsightsNarrative(sectionMetrics as KeyInsights);
      default:
        return "No narrative available for this section.";
    }
  };
  const instruction =
    sectionKey === "key_insights"
      ? `Write 4-6 sentences of standout, non-obvious talking points a CSM could raise in a live QBR/EBR meeting — things a customer wouldn't already know from their own dashboard (who the top performer is, payment/quote velocity, customer concentration, dormant seats, at-risk high-value accounts). Skip anything not present in the JSON.`
      : `Write one short narrative paragraph (2-4 sentences) for the "${sectionKey}" section of this report.`;
  return generate(instruction, sectionMetrics, fallback, sectionKey === "key_insights" ? 600 : 400);
}

export async function generateRecommendation(sectionKey: string, rule: RuleMatch): Promise<string> {
  return generate(
    `Write a 1-2 sentence actionable recommendation for the "${sectionKey}" section, based on this specific issue detected by the rules engine. Start with "Recommendation:".`,
    { rule },
    () => templateRecommendation(rule)
  );
}
