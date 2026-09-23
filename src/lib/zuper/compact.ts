// Shrinks a raw Zuper API record to the parts worth analysing, so "store everything"
// stays within database limits: scalars are kept, nested objects are flattened to
// their names/ids/scalars ("customer.customer_name"), arrays become a count plus
// the names of their first few items. Deterministic — no field is guessed or renamed.

export type CompactRecord = Record<string, string | number | boolean | null>;

const MAX_STRING = 300;
const NAME_KEY = /(^|_)(name|title|uid|type|status|label|number|no|id|email|code|amount|total|value|rating)$/i;

function scalar(v: unknown): string | number | boolean | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return undefined;
}

export function compactRecord(raw: Record<string, unknown>, depth = 0, prefix = ""): CompactRecord {
  const out: CompactRecord = {};
  for (const [key, value] of Object.entries(raw)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const s = scalar(value);
    if (s !== undefined) {
      out[path] = s;
      continue;
    }
    if (Array.isArray(value)) {
      out[`${path}.length`] = value.length;
      const names = value
        .slice(0, 5)
        .map((item) => (item && typeof item === "object" ? Object.entries(item as Record<string, unknown>).find(([k, v]) => /name|title/i.test(k) && typeof v === "string")?.[1] : scalar(item)))
        .filter((x) => typeof x === "string" && x) as string[];
      if (names.length) out[`${path}.names`] = names.join(" | ").slice(0, MAX_STRING);
      continue;
    }
    if (value && typeof value === "object") {
      if (depth >= 1) {
        // Deep objects: keep only identifying fields.
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const sv = scalar(v);
          if (sv !== undefined && NAME_KEY.test(k)) out[`${path}.${k}`] = sv;
        }
      } else {
        Object.assign(out, compactRecord(value as Record<string, unknown>, depth + 1, path));
      }
    }
  }
  return out;
}

export interface FieldStat {
  path: string;
  filled: number;
  sample: string | null;
}

/** Fill rate of each field across records (most-filled first), capped to `limit` fields. */
export function fieldStats(records: CompactRecord[], limit = 80): FieldStat[] {
  const stats = new Map<string, { filled: number; sample: string | null }>();
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      const s = stats.get(k) ?? { filled: 0, sample: null };
      if (v !== null && v !== "" && v !== 0 && v !== false) {
        s.filled += 1;
        if (s.sample == null) s.sample = String(v).slice(0, 60);
      }
      stats.set(k, s);
    }
  }
  return [...stats.entries()]
    .map(([path, s]) => ({ path, ...s }))
    .sort((a, b) => b.filled - a.filled)
    .slice(0, limit);
}
