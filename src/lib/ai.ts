import { GoogleGenAI } from "@google/genai";
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
  LineItemUsage,
} from "@/lib/analytics";
import { usageInsight } from "@/lib/pptx/usageSlide";
import type { RecommendationSignal } from "@/lib/reports/ebrMetrics";
import type { WebsiteContext } from "@/lib/website";
import { ZUPER_PRODUCT_KNOWLEDGE } from "@/lib/zuperProductKnowledge";

const SYSTEM_PROMPT = `You are writing content for a Zuper customer business review (monthly, quarterly, half-yearly or yearly).
You will be given a JSON object of pre-computed metrics. Write only about numbers present in
that JSON, using them exactly as given — never calculate, round differently, or invent a number.
If a metric needed to support a claim isn't in the JSON, don't make the claim. Tone: confident,
concise, written for an account's stakeholders and the CSM team presenting it. No markdown, no
bullet points — plain prose paragraphs only.`;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export function aiEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

async function callGemini(
  systemInstruction: string,
  prompt: string,
  maxOutputTokens: number,
  { thinkingBudget = 0, json = false }: { thinkingBudget?: number; json?: boolean } = {}
): Promise<string> {
  const ai = client();
  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    // Gemini 2.5 counts "thinking" tokens against maxOutputTokens, which truncated these short
    // outputs (and silently fell back to templates). Rewording pre-computed numbers needs no
    // reasoning budget; callers that ask for judgement (the Account Brief) pass one and a larger max.
    config: { systemInstruction, maxOutputTokens, thinkingConfig: { thinkingBudget }, ...(json ? { responseMimeType: "application/json" } : {}) },
  });
  return (res.text ?? "").trim();
}

/**
 * Asks for a JSON object and returns it parsed — or null when AI is off, the call fails twice, the
 * output isn't the expected shape, or it contains a number that isn't in `facts`.
 */
export async function generateCheckedJson<T>(
  system: string,
  prompt: string,
  facts: unknown,
  isValid: (v: unknown) => v is T,
  { maxOutputTokens = 4000, thinkingBudget = 0 }: { maxOutputTokens?: number; thinkingBudget?: number } = {}
): Promise<T | null> {
  if (!aiEnabled()) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGemini(system, prompt, maxOutputTokens, { thinkingBudget, json: true });
      if (!validateNoInventedNumbers(text, facts)) continue;
      const parsed: unknown = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim());
      if (isValid(parsed)) return parsed;
    } catch {
      // network/API/parse failure — retry once, then give up
    }
  }
  return null;
}

async function generate(
  userPrompt: string,
  inputJson: unknown,
  fallback: () => string,
  maxTokens = 400
): Promise<string> {
  if (!aiEnabled()) return fallback();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGemini(
        SYSTEM_PROMPT,
        `${userPrompt}\n\nMetrics JSON:\n${JSON.stringify(inputJson, null, 2)}`,
        maxTokens
      );
      if (validateNoInventedNumbers(text, inputJson)) return text;
    } catch {
      // network/API error — fall through to retry, then fallback
    }
  }
  return fallback();
}

// ---------------------------------------------------------------------------
// Template fallbacks — used whenever GEMINI_API_KEY isn't set. Every
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
      case "parts_usage":
        return usageInsight(sectionMetrics as LineItemUsage);
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

// ---------------------------------------------------------------------------
// Industry & journey narrative. The website text is framing only (what the
// business does, how it describes itself); every number must come from `facts`
// — validateNoInventedNumbers() checks against facts alone, not the website.
// ---------------------------------------------------------------------------

export async function generateStoryNarrative(
  kind: "industry" | "journey",
  facts: Record<string, unknown>,
  website: WebsiteContext | null,
  fallback: string
): Promise<string> {
  if (!aiEnabled()) return fallback;
  const context = website ? `\nHow the business describes itself (framing only — never a source of numbers):\n${JSON.stringify({ title: website.title, description: website.description, excerpt: website.excerpt.slice(0, 1500) })}` : "";
  const task =
    kind === "industry"
      ? "Write 2-3 sentences for a CSM presenting to this customer: what kind of business this is (from the context), and what its own numbers in FACTS say about how it's running on the dimensions that matter most in its trade. Plain, specific, no hype, no benchmarks."
      : "Write 2-3 sentences telling the story of this customer's time on Zuper: how the operation looked in the early months versus now, using only the before/after figures in FACTS. Say 'since moving onto Zuper' or 'over their time on Zuper' — never claim Zuper caused the change. Mention one thing that got better and, if present, one thing to work on.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGemini(SYSTEM_PROMPT, `${task}${context}\n\nFACTS:\n${JSON.stringify(facts, null, 2)}`, 350);
      if (text && validateNoInventedNumbers(text, facts)) return text;
    } catch {
      // network/API error — retry once, then fall back
    }
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Business-aware recommendations for the "Recommended Priorities" slide.
// Grounded in: (1) computeRecommendationSignals()'s deterministic signals —
// the ONLY numbers the AI is allowed to use, (2) a curated Zuper product
// reference so recommendations name real features/mechanics correctly, and
// (3) best-effort customer website context, for framing/tone only — never a
// source of numbers, so validateNoInventedNumbers() doesn't check against it.
// ---------------------------------------------------------------------------

export interface BusinessRecommendation {
  title: string;
  description: string;
}

/** At most four, all data-backed: the deck fills any empty slot from the account's own improvement
 * call-outs (see ebrExport), never from generic filler text. */
function fillToFour(recs: BusinessRecommendation[]): BusinessRecommendation[] {
  return recs.slice(0, 4);
}

export async function generateBusinessRecommendations(
  signals: RecommendationSignal[],
  websiteContext: WebsiteContext | null,
  reportTypeLabel: string
): Promise<BusinessRecommendation[]> {
  const fallback = () => fillToFour(signals.map((s) => ({ title: s.title, description: s.detail })));

  if (!aiEnabled() || signals.length === 0) return fallback();

  const businessContext = websiteContext
    ? {
        websiteTitle: websiteContext.title,
        websiteDescription: websiteContext.description,
        websiteExcerpt: websiteContext.excerpt.slice(0, 2000),
      }
    : null;

  const inputJson = { signals, reportTypeLabel };

  const prompt = `Rewrite these ${signals.length} data-backed recommendation signal(s) for a ${reportTypeLabel} "Recommended Priorities" slide.
For EACH signal, produce a short punchy title (max 6 words) and a 1-2 sentence description that keeps every number in "detail" exactly as given.
You may use the business context below ONLY to adjust tone/framing (e.g. reference the kind of business this is) — never to invent a number or a fact not in the signals.
${businessContext ? `\nBusiness context (from the customer's own website, for tone only):\n${JSON.stringify(businessContext, null, 2)}` : ""}

Respond with ONLY a JSON array, no markdown fences, no other text, in this exact shape:
[{"title": "...", "description": "..."}, ...]`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callGemini(
        `${SYSTEM_PROMPT}\n\n${ZUPER_PRODUCT_KNOWLEDGE}`,
        `${prompt}\n\nSignals JSON:\n${JSON.stringify(inputJson, null, 2)}`,
        800
      );
      if (!validateNoInventedNumbers(text, inputJson)) continue;

      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      if (
        Array.isArray(parsed) &&
        parsed.every((p) => typeof p?.title === "string" && typeof p?.description === "string")
      ) {
        return fillToFour(parsed as BusinessRecommendation[]);
      }
    } catch {
      // parse/network failure — retry once, then fall back
    }
  }
  return fallback();
}
