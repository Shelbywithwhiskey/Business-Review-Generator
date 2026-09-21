import Anthropic from "@anthropic-ai/sdk";
import type { PeriodMetrics, ComparisonResult, RuleMatch, HealthScoreResult } from "@/lib/analytics";

const SYSTEM_PROMPT = `You are writing content for a Zuper customer business review (QBR/MBR).
You will be given a JSON object of pre-computed metrics. Write only about numbers present in
that JSON, using them exactly as given — never calculate, round differently, or invent a number.
If a metric needed to support a claim isn't in the JSON, don't make the claim. Tone: confident,
concise, written for an account's stakeholders and the CSM team presenting it. No markdown, no
bullet points — plain prose paragraphs only.`;

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
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

async function generate(userPrompt: string, inputJson: unknown, maxTokens = 400): Promise<string> {
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
  return "AI narrative unavailable for this section — please write manually.";
}

export async function generateExecutiveSummary(
  metrics: PeriodMetrics,
  comparison: ComparisonResult | undefined,
  health: HealthScoreResult
): Promise<string> {
  return generate(
    "Write a 3-5 sentence executive summary of this account's performance for the period, referencing the health score and any period-over-period change.",
    { metrics, comparison: comparison?.changePct, health },
    500
  );
}

export async function generateSectionNarrative(sectionKey: string, sectionMetrics: unknown): Promise<string> {
  return generate(
    `Write one short narrative paragraph (2-4 sentences) for the "${sectionKey}" section of this report.`,
    sectionMetrics
  );
}

export async function generateRecommendation(sectionKey: string, rule: RuleMatch): Promise<string> {
  return generate(
    `Write a 1-2 sentence actionable recommendation for the "${sectionKey}" section, based on this specific issue detected by the rules engine. Start with "Recommendation:".`,
    { rule }
  );
}
