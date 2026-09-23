// Best-effort fetch + text extraction for a customer's website, used as
// business-context input to the AI engine. No headless browser — this reads
// whatever HTML the server returns, so heavily JS-rendered sites may yield
// thin content. That's an acceptable tradeoff for a CSM-facing internal tool.

const MAX_CONTENT_CHARS = 6000;
const FETCH_TIMEOUT_MS = 10_000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function extractTag(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

function extractMeta(html: string, name: string): string | null {
  const match = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"));
  return match ? match[1].trim() : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface WebsiteContext {
  url: string;
  title: string | null;
  description: string | null;
  excerpt: string;
}

/** Returns null on any failure (unreachable, non-HTML, timeout) — this is best-effort context, never a hard dependency. */
export async function fetchWebsiteContext(rawUrl: string): Promise<WebsiteContext | null> {
  const url = normalizeUrl(rawUrl);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ZuperCBRGenerator/1.0)" },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = await res.text();
    const title = extractTag(html, "title");
    const description = extractMeta(html, "description") ?? extractMeta(html, "og:description");
    const excerpt = stripHtml(html).slice(0, MAX_CONTENT_CHARS);

    return { url, title, description, excerpt };
  } catch {
    return null;
  }
}
