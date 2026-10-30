import { generateCheckedJson } from "@/lib/ai";
import type { Callout } from "@/lib/reports/callouts";
import type { IndustryResult } from "@/lib/reports/industry";
import type { WebsiteContext } from "@/lib/website";
import { ZUPER_PRODUCT_KNOWLEDGE } from "@/lib/zuperProductKnowledge";
import { exclusionModuleLabel, summarizeExclusions } from "@/lib/zuper/testRecords";

// ---------------------------------------------------------------------------
// Account Brief: the deck's findings read the way an account manager / CSM
// would before a review — what this business is, how it's really using Zuper,
// what to celebrate, what threatens the account, where to expand, and what to
// do and ask next. Built at export time from every call-out the deck produced
// (so it never disagrees with the slides), the CSM's own "About the company"
// notes, and the website (framing only). Gemini writes it; every number must
// appear in the facts, otherwise the rule-based version below is used.
// ---------------------------------------------------------------------------

export interface BriefItem {
  headline: string;
  detail: string;
}

export type BriefHealth = "healthy" | "steady" | "at_risk";

export interface AccountBrief {
  generatedAt: string;
  /** "ai" when Gemini wrote it, "rules" for the deterministic fallback. */
  source: "ai" | "rules";
  periodLabel: string;
  /** What the business does and how it runs on Zuper. */
  businessRead: string;
  health: { status: BriefHealth; why: string };
  highlights: BriefItem[];
  risks: BriefItem[];
  opportunities: BriefItem[];
  /** For the account manager — what to do next. */
  nextActions: string[];
  /** Discovery questions to ask in the meeting. */
  questions: string[];
  /** e.g. "37 test / Zuper setup records (jobs, customers) were left out of every number." */
  excludedNote: string | null;
}

export interface BriefInput {
  customerName: string;
  periodLabel: string;
  /** The CSM's "About the company" notes. */
  about: string | null;
  website: WebsiteContext | null;
  industry: Pick<IndustryResult, "label" | "confidence" | "model" | "plays">;
  monthsOnZuper: number | null;
  /** Every call-out in the deck, any order. */
  callouts: Callout[];
  modules: { inUse: string[]; noRecords: string[]; notEnabled: string[] };
  testExclusions: unknown;
}

export const HEALTH_LABEL: Record<BriefHealth, string> = { healthy: "Healthy", steady: "Steady", at_risk: "At risk" };

const SYSTEM = `You are the Zuper account manager / customer success manager who owns this account, preparing for a business review with the customer.
Think the way a good AM does: understand what the customer's business is and what it needs to succeed, read how they actually use Zuper, and connect the two —
which results matter to *this* business, what puts the account (and renewal) at risk, and which Zuper capabilities would genuinely help them next.

Rules:
- Every number you write must appear in FACTS exactly as given. Never calculate, round differently, or invent a figure. If no number supports a point, make it without one.
- "aboutCompany" was written by the CSM and is trusted context. The website text is framing only — never a source of numbers or claims about usage.
- Only recommend a Zuper capability that is in the product reference below AND supported by a finding in FACTS.
- Don't claim Zuper caused a change; say "since moving onto Zuper" or "on Zuper".
- Be specific and plain-spoken. No hype, no markdown, no emojis.

${ZUPER_PRODUCT_KNOWLEDGE}`;

function exclusionNote(value: unknown): string | null {
  const { total, byModule } = summarizeExclusions(value);
  if (!total) return null;
  const where = byModule.slice(0, 4).map((m) => exclusionModuleLabel(m.module)).join(", ");
  return `${total.toLocaleString("en-US")} test / Zuper setup records (${where}) were left out of every number.`;
}

function facts(input: BriefInput) {
  const ranked = [...input.callouts].sort((a, b) => b.score - a.score);
  // De-duplicate on headline (the same finding can appear on two slides).
  const seen = new Set<string>();
  const findings = ranked
    .filter((c) => !seen.has(c.headline) && seen.add(c.headline))
    .slice(0, 28)
    .map((c) => ({ type: c.tone, area: c.area, finding: c.headline, soWhat: c.detail }));
  return {
    customer: input.customerName,
    period: input.periodLabel,
    aboutCompany: input.about?.trim() || null,
    trade: { label: input.industry.label, confidence: input.industry.confidence, howTheseBusinessesRun: input.industry.model, typicalPlays: input.industry.plays.map((p) => `${p.feature}: ${p.why}`) },
    monthsOnZuper: input.monthsOnZuper,
    findings,
    zuperAreasInUse: input.modules.inUse,
    zuperAreasWithNoRecords: input.modules.noRecords,
    zuperAreasNotEnabled: input.modules.notEnabled,
    testRecordsLeftOut: summarizeExclusions(input.testExclusions).total,
  };
}

const PROMPT = `Write the Account Brief as a JSON object with exactly these keys:
{
  "businessRead": "2-3 sentences: what this company does and who it serves (from aboutCompany, the website and trade), then how it is actually running on Zuper (from findings and the areas in use).",
  "health": { "status": "healthy" | "steady" | "at_risk", "why": "one sentence grounded in findings" },
  "highlights": [ { "headline": "max 12 words, with the number", "detail": "one sentence: why this result matters to this business" } ],   // 3-4 wins to celebrate
  "risks": [ { "headline": "...", "detail": "one sentence: what could go wrong for the account or renewal" } ],                         // 2-3
  "opportunities": [ { "headline": "...", "detail": "one sentence: the Zuper capability and the evidence for it" } ],                 // 2-3 adoption / expansion plays
  "nextActions": [ "short imperative for the account manager, e.g. 'Book a Workflow Builder session with the ops lead'" ],          // 3-5
  "questions": [ "a discovery question to ask the customer in the meeting" ]                                                      // 2-3
}
Use each finding at most once across highlights, risks and opportunities. Tie points to what this business cares about — not generic SaaS advice.`;

function isItems(v: unknown, min: number, max: number): v is BriefItem[] {
  return (
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= max &&
    v.every((i: { headline?: unknown; detail?: unknown } | null) => typeof i?.headline === "string" && typeof i?.detail === "string" && !!i.headline.trim() && !!i.detail.trim())
  );
}

function isStrings(v: unknown, min: number, max: number): v is string[] {
  return Array.isArray(v) && v.length >= min && v.length <= max && v.every((s) => typeof s === "string" && s.trim());
}

type AiBrief = Pick<AccountBrief, "businessRead" | "health" | "highlights" | "risks" | "opportunities" | "nextActions" | "questions">;

function isAiBrief(v: unknown): v is AiBrief {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  const health = (b.health ?? {}) as { status?: unknown; why?: unknown };
  return (
    typeof b.businessRead === "string" &&
    b.businessRead.trim().length > 0 &&
    (health.status === "healthy" || health.status === "steady" || health.status === "at_risk") &&
    typeof health.why === "string" &&
    isItems(b.highlights, 1, 4) &&
    isItems(b.risks, 0, 3) &&
    isItems(b.opportunities, 0, 3) &&
    isStrings(b.nextActions, 1, 5) &&
    isStrings(b.questions, 0, 3)
  );
}

// ---- Rule-based fallback (no AI key, or the AI output failed a check) -------------------------

function firstSentences(text: string, n: number): string {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g) ?? [text.trim()];
  return parts.slice(0, n).map((p) => p.trim()).join(" ");
}

function rulesBrief(input: BriefInput): AiBrief {
  const ranked = [...input.callouts].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const unique = ranked.filter((c) => !seen.has(c.headline) && seen.add(c.headline));
  const pick = (tones: Callout["tone"][], n: number) => unique.filter((c) => tones.includes(c.tone)).slice(0, n);
  const wins = pick(["win"], 4);
  const risks = pick(["risk"], 3);
  const watch = pick(["watch"], Math.max(0, 3 - risks.length));
  const opps = pick(["opportunity"], 3);
  const item = (c: Callout): BriefItem => ({ headline: c.headline, detail: c.detail.replace(/^./, (s) => s.toUpperCase()) });

  const tenure = input.monthsOnZuper ? ` and has been on Zuper for ${input.monthsOnZuper} months` : "";
  const about = input.about?.trim() ? `${firstSentences(input.about, 2)} ` : "";
  // Acronym labels ("HVAC") keep their case; others read as plain words ("general field service").
  const trade = input.industry.label === input.industry.label.toUpperCase() ? input.industry.label : input.industry.label.toLowerCase();
  const businessRead = `${about}${input.customerName} works in ${trade}${tenure}; ${input.modules.inUse.length} areas of Zuper hold records for this account.`;

  const riskCount = unique.filter((c) => c.tone === "risk").length;
  const winCount = unique.filter((c) => c.tone === "win").length;
  // Healthy only when wins clearly outweigh risks; a tie is "steady".
  const status: BriefHealth = riskCount >= 3 && riskCount > winCount ? "at_risk" : winCount > riskCount ? "healthy" : "steady";

  const opportunities = opps.map(item);
  // Thin on data-backed opportunities: offer the trade's typical plays for areas not in use yet.
  for (const play of input.industry.plays) {
    if (opportunities.length >= 2) break;
    opportunities.push({ headline: play.feature, detail: play.why });
  }

  return {
    businessRead,
    health: { status, why: `${winCount} wins and ${riskCount} risks were flagged across the account this period.` },
    highlights: wins.map(item),
    risks: [...risks, ...watch].map(item),
    opportunities,
    nextActions: [
      ...[...risks, ...watch].slice(0, 2).map((c) => `Agree an owner and a fix with the customer for: ${c.headline.replace(/\.$/, "")}`),
      ...opps.slice(0, 2).map((c) => `Propose a next step on: ${c.headline.replace(/\.$/, "")}`),
      "Confirm the customer's goals for the next period and how they will measure success on Zuper",
    ].slice(0, 5),
    questions: [
      "What are the business's priorities for the next quarter, and where is the team losing the most time today?",
      ...(input.modules.noRecords.length ? [`Are there plans to start using ${input.modules.noRecords.slice(0, 2).join(" or ")}?`] : []),
    ],
  };
}

export async function buildAccountBrief(input: BriefInput): Promise<AccountBrief> {
  const f = facts(input);
  const base = { generatedAt: new Date().toISOString(), periodLabel: input.periodLabel, excludedNote: exclusionNote(input.testExclusions) };
  const website = input.website
    ? `\n\nHow the business describes itself on its website (framing only):\n${JSON.stringify({ title: input.website.title, description: input.website.description, excerpt: input.website.excerpt.slice(0, 1500) })}`
    : "";
  const ai = await generateCheckedJson(SYSTEM, `${PROMPT}${website}\n\nFACTS:\n${JSON.stringify(f, null, 2)}`, f, isAiBrief, {
    maxOutputTokens: 8000,
    thinkingBudget: 2048,
  });
  if (ai) return { ...base, source: "ai", ...ai };
  return { ...base, source: "rules", ...rulesBrief(input) };
}
