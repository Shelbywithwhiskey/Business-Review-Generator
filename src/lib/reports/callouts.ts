// ---------------------------------------------------------------------------
// Call-outs: the one-line findings a CSM should say out loud. Each slide builds
// its own from computed metrics (never AI), ranks them by `score`, shows the top
// few on the slide, and the deck's "Top Call-outs" slide picks the best across
// every area. Every number in a call-out is a computed value from that slide.
// ---------------------------------------------------------------------------

export type Tone = "win" | "risk" | "opportunity" | "watch";

export interface Callout {
  tone: Tone;
  /** Short, specific headline with the number in it — e.g. "612 jobs are past due and still open". */
  headline: string;
  /** The "so what" — why it matters or what to do, one sentence. */
  detail: string;
  /** Priority 0–100: how material the finding is. Used to rank on-slide and deck-wide. */
  score: number;
  /** Area label shown on the Top Call-outs slide, e.g. "Jobs", "Collections". */
  area: string;
}

export const TONE_LABEL: Record<Tone, string> = { win: "WIN", risk: "RISK", opportunity: "OPPORTUNITY", watch: "WATCH" };

export function rank(callouts: (Callout | null | undefined | false)[]): Callout[] {
  return callouts.filter((c): c is Callout => !!c).sort((a, b) => b.score - a.score);
}

/** Top `n` across the deck, at most `perArea` from any one area, so the summary isn't all one topic. */
export function topAcross(all: Callout[], n = 6, perArea = 2): Callout[] {
  const out: Callout[] = [];
  const count = new Map<string, number>();
  // The same finding can surface on two slides (e.g. failed runs on Platform and Executions):
  // treat call-outs that share a distinctive number (3+ digits) as duplicates.
  const bigNumbers = (c: Callout) => new Set((`${c.headline} ${c.detail}`.match(/\d[\d,.]{2,}/g) ?? []).map((x) => x.replace(/[,.]$/, "")));
  for (const c of rank(all)) {
    if ((count.get(c.area) ?? 0) >= perArea) continue;
    const nums = bigNumbers(c);
    if (out.some((o) => [...bigNumbers(o)].some((x) => nums.has(x)))) continue;
    out.push(c);
    count.set(c.area, (count.get(c.area) ?? 0) + 1);
    if (out.length >= n) break;
  }
  return out;
}

/** Plain-text form for speaker notes. */
export function calloutLine(c: Callout): string {
  return `${TONE_LABEL[c.tone]}: ${c.headline} — ${c.detail}`;
}

// ---- Trend helper ---------------------------------------------------------------------------

export interface Momentum {
  recent: number;
  prior: number;
  /** (recent − prior) ÷ prior; null when prior is too small to compare. */
  change: number | null;
  recentLabel: string;
  priorLabel: string;
}

/** Last `window` months vs the `window` months before, from a monthly series (oldest first). */
export function momentum(monthly: { label: string; value: number }[], window = 3, minPrior = 10): Momentum | null {
  if (monthly.length < window * 2) return null;
  const recent = monthly.slice(-window);
  const prior = monthly.slice(-window * 2, -window);
  const r = recent.reduce((s, m) => s + m.value, 0);
  const p = prior.reduce((s, m) => s + m.value, 0);
  // A prior window that starts before the first month with any activity is a ramp-up, not a
  // baseline — comparing against it would overstate growth (e.g. a feature switched on mid-window).
  const firstActive = monthly.findIndex((m) => m.value > 0);
  const priorStart = monthly.length - window * 2;
  const rampUp = firstActive < 0 || firstActive > priorStart;
  return {
    recent: r,
    prior: p,
    change: p >= minPrior && !rampUp ? (r - p) / p : null,
    recentLabel: `${recent[0].label}–${recent[recent.length - 1].label}`,
    priorLabel: `${prior[0].label}–${prior[prior.length - 1].label}`,
  };
}

export function momentumPhrase(m: Momentum | null, noun: string): string | null {
  if (!m || m.change == null) return null;
  const dir = m.change >= 0 ? "up" : "down";
  return `${noun} ${dir} ${Math.abs(m.change * 100).toFixed(0)}% in ${m.recentLabel} vs ${m.priorLabel} (${Math.round(m.recent).toLocaleString("en-US")} vs ${Math.round(m.prior).toLocaleString("en-US")})`;
}
