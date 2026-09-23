// Generic injector for the line-chart XML shape used by every chart in the EBR
// template (ppt/charts/chartN.xml): one shared <c:cat> block per series, one
// <c:val><c:numRef><c:numCache> block per series, and a single value-axis
// <c:max>. All six template charts follow this exact schema (1 or 2 series,
// c:lineChart), so this one function rewrites all of them.
//
// Matching is structural (Nth <c:ser> in document order), not by series name.
// null values become gaps (no point, no label); zero values keep their point but
// hide their label so "$0.00M" labels don't pile up on the category axis.

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCatBlock(original: string, categories: string[]): string {
  const pts = categories.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeXml(c)}</c:v></c:pt>`).join("");
  // Preserve the original <c:f> formula reference (range address) untouched; only rewrite the cache.
  const fMatch = original.match(/<c:f>([^<]*)<\/c:f>/);
  const f = fMatch ? fMatch[1] : "Sheet1!$A$2:$A$" + (categories.length + 1);
  return `<c:cat><c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${categories.length}"/>${pts}</c:strCache></c:strRef></c:cat>`;
}

function buildNumCacheBlock(original: string, values: (number | null)[]): string {
  const formatMatch = original.match(/<c:formatCode>([^<]*)<\/c:formatCode>/);
  const formatCode = formatMatch ? formatMatch[1] : "General";
  const pts = values.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("");
  return `<c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

/** Locks number formats to en-US so digit grouping doesn't follow the viewer's locale (e.g. 1,99,662). */
function lockLocale(format: string): string {
  return format.includes("[$") || format === "General" ? format : `[$-409]${format}`;
}

export interface LineChartData {
  categories: string[];
  /** One array of values per series, in <c:ser> order. null = no data for that category (gap). */
  seriesValues: (number | null)[][];
  /** Rounds the value axis max up to a "nice" bound above the largest value; omit to leave the template's axis untouched. */
  axisMax?: number;
}

const SER_RE = /<c:ser>[\s\S]*?<\/c:ser>/g;
const CAT_BLOCK_RE = /<c:cat>[\s\S]*?<\/c:cat>/;
const NUM_CACHE_RE = /<c:numCache>[\s\S]*?<\/c:numCache>/;
const MAX_VAL_RE = /(<c:valAx>[\s\S]*?<c:max val=")[^"]*("\/>)/;

export function injectLineChartData(xml: string, data: LineChartData): string {
  let seriesIdx = 0;
  let out = xml.replace(SER_RE, (ser) => {
    const values = data.seriesValues[seriesIdx];
    seriesIdx += 1;
    let s = ser.replace(CAT_BLOCK_RE, (m) => buildCatBlock(m, data.categories));
    if (!values) return s;
    s = s.replace(NUM_CACHE_RE, (m) => buildNumCacheBlock(m, values));
    // Labels above their points: below-point labels on near-zero values sat on the category axis text.
    s = s.replace(/(<c:dLbls>[\s\S]*?)<c:dLblPos val="[^"]*"\/>/, '$1<c:dLblPos val="t"/>');
    // Hide labels for missing or zero points (dLbl entries must come first inside <c:dLbls>).
    const hidden = values.map((v, i) => (v == null || v === 0 ? i : -1)).filter((i) => i >= 0);
    if (hidden.length) {
      const dels = hidden.map((i) => `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>`).join("");
      s = s.replace(/<c:dLbls>(\s*<c:dLbl>[\s\S]*?<\/c:dLbl>)*/, () => `<c:dLbls>${dels}`);
    }
    return s;
  });

  if (data.axisMax != null) out = out.replace(MAX_VAL_RE, `$1${data.axisMax}$2`);
  out = out.replace(/<c:dispBlanksAs val="[^"]*"\/>/, '<c:dispBlanksAs val="gap"/>');
  out = out.replace(/formatCode="([^"]*)"/g, (_m, f: string) => `formatCode="${lockLocale(f)}"`);
  out = out.replace(/<c:formatCode>([^<]*)<\/c:formatCode>/g, (_m, f: string) => `<c:formatCode>${lockLocale(f)}</c:formatCode>`);
  return out;
}

/** Rounds up to a visually clean axis max (e.g. 17 -> 20, 123 -> 150, 1.4 -> 2). */
export function niceAxisMax(maxValue: number): number {
  if (maxValue <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
  const normalized = maxValue / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}
