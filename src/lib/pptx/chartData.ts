// Generic injector for the line-chart XML shape used by every chart in the EBR
// template (ppt/charts/chartN.xml): one shared <c:cat> block per series, one
// <c:val><c:numRef><c:numCache> block per series, and a single value-axis
// <c:max>. All six template charts follow this exact schema (1 or 2 series,
// c:lineChart), so this one function rewrites all of them.
//
// Matching is structural (Nth occurrence in document order), not by series
// name, so it's independent of exact label text.

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

function buildNumCacheBlock(original: string, values: number[]): string {
  const formatMatch = original.match(/<c:formatCode>([^<]*)<\/c:formatCode>/);
  const formatCode = formatMatch ? formatMatch[1] : "General";
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("");
  return `<c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

export interface LineChartData {
  categories: string[];
  /** One array of values per series, in the same order as <c:ser> blocks appear in the file. */
  seriesValues: number[][];
  /** Rounds the value axis max up to a "nice" bound above the largest value; omit to leave the template's axis untouched. */
  axisMax?: number;
}

const CAT_BLOCK_RE = /<c:cat>[\s\S]*?<\/c:cat>/g;
const NUM_CACHE_RE = /<c:numCache>[\s\S]*?<\/c:numCache>/g;
const MAX_VAL_RE = /(<c:valAx>[\s\S]*?<c:max val=")[^"]*("\/>)/;

export function injectLineChartData(xml: string, data: LineChartData): string {
  let out = xml.replace(CAT_BLOCK_RE, (match) => buildCatBlock(match, data.categories));

  let seriesIdx = 0;
  out = out.replace(NUM_CACHE_RE, (match) => {
    const values = data.seriesValues[seriesIdx];
    seriesIdx += 1;
    if (!values) return match;
    return buildNumCacheBlock(match, values);
  });

  if (data.axisMax != null) {
    out = out.replace(MAX_VAL_RE, `$1${data.axisMax}$2`);
  }

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
