// ---------------------------------------------------------------------------
// Test / setup records: data a Zuper employee created during onboarding, or
// records named like "Test Customer" / "Demo job". They are dropped at sync
// time (never stored), so every metric, call-out and slide leaves them out
// without each query having to filter. What was dropped is summarised on the
// Customer (testExclusions) so reports can say so.
// ---------------------------------------------------------------------------

/** Whole-word markers in the name of a customer, organization, property or product: "Test Customer",
 * "Demo Org", "DO NOT USE". "Demolition", "Contest", "Testa" don't match. "Testing" is left out because
 * real businesses are named that (e.g. "ABC Backflow Testing"). */
const TEST_NAME = /(^|[^a-z0-9])(test|demo|dummy|sample|asdf|qwerty|fake|do\s*not\s*use|don'?t\s*use)([^a-z0-9]|$)/i;
/** Job / quote / invoice titles describe the work, and "Backflow Test" or "Fire alarm test" is real work —
 * so a title only counts when it is nothing but a test marker: "Test", "test job 2", "Demo", "asdf". */
const TEST_TITLE = /^\s*(test|testing|demo|dummy|sample|asdf|qwerty|fake)(\s+(job|quote|estimate|invoice|order|record|entry|data|request))?[\s\d.!#-]*$|do\s*not\s*use|don'?t\s*use/i;
const ZUPER_STAFF_EMAIL = /@zuper\.co$/i;

/** Paths on a raw Zuper record holding a title that describes the work (checked with TEST_TITLE). */
const TITLE_PATHS = ["job_title", "title", "estimate_title", "invoice_title"];

/** Paths (dot-separated) on a raw Zuper record holding the name of the record, or of the customer/org/property it belongs to. */
const NAME_PATHS = [
  "name",
  "customer_first_name",
  "customer_last_name",
  "customer_company_name",
  "customer.customer_first_name",
  "customer.customer_last_name",
  "customer.customer_company_name",
  "customer_name",
  "organization_name",
  "organization.organization_name",
  "property_name",
  "property.property_name",
  "project_name",
  "product_name",
];

/** Paths holding the email of whoever created the record. */
const CREATOR_EMAIL_PATHS = ["created_by.email", "created_by_user.email", "created_by.user_email", "created_by_email"];

function at(raw: Record<string, unknown>, path: string): unknown {
  let cur: unknown = raw;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function isTestName(name: unknown): boolean {
  return typeof name === "string" && TEST_NAME.test(name);
}

export function isZuperStaffEmail(email: unknown): boolean {
  return typeof email === "string" && ZUPER_STAFF_EMAIL.test(email.trim());
}

/** Why a raw Zuper record counts as test/setup data, or null when it's real. `ownEmail` is for user records, whose own email is checked. */
export function testReason(raw: Record<string, unknown>, { ownEmail = false }: { ownEmail?: boolean } = {}): string | null {
  for (const path of CREATOR_EMAIL_PATHS) {
    if (isZuperStaffEmail(at(raw, path))) return "created by Zuper staff";
  }
  if (ownEmail && isZuperStaffEmail(raw.email)) return "Zuper staff user";
  for (const path of TITLE_PATHS) {
    const v = at(raw, path);
    if (typeof v === "string" && TEST_TITLE.test(v)) return `test title "${v.trim().slice(0, 60)}"`;
  }
  for (const path of NAME_PATHS) {
    const v = at(raw, path);
    if (isTestName(v)) return `test-like name "${String(v).trim().slice(0, 60)}"`;
  }
  return null;
}

// ---- What was excluded, per module ------------------------------------------------------------

export interface ModuleExclusion {
  count: number;
  /** A few reasons/examples, for the report notes. */
  examples: string[];
  /** Excluded invoice uids only — a later sync step drops payments made against them. */
  uids?: string[];
}

/** Modules whose excluded uids are kept on the Customer for a later step. */
const KEEP_UIDS = new Set(["invoices"]);
const MAX_KEPT_UIDS = 5000;

export interface TestExclusions {
  updatedAt: string;
  modules: Record<string, ModuleExclusion>;
}

/** Collects exclusions during one sync. A module's entry replaces the stored one only for modules this sync pulled. */
export class ExclusionLog {
  readonly modules: Record<string, ModuleExclusion> = {};
  /** Zuper uids excluded this sync, per module — rows an earlier sync stored under them are deleted. Not persisted. */
  readonly uids: Record<string, Set<string>> = {};

  add(module: string, reason: string, uid?: string) {
    const m = (this.modules[module] ??= { count: 0, examples: [] });
    m.count += 1;
    if (m.examples.length < 5 && !m.examples.includes(reason)) m.examples.push(reason);
    if (uid) (this.uids[module] ??= new Set()).add(uid);
  }

  excludedUids(module: string): string[] {
    return [...(this.uids[module] ?? [])];
  }

  /** Marks a module as pulled even if nothing was excluded, so a stale count from an earlier sync is cleared. */
  touch(module: string) {
    this.modules[module] ??= { count: 0, examples: [] };
  }

  /**
   * The stored summary with this log applied. A module's entry replaces the stored one, except for
   * modules in `continuing` (a sync step resuming that module mid-way), whose counts are added.
   */
  mergeInto(previous: unknown, continuing: ReadonlySet<string> = new Set()): TestExclusions {
    const prev = storedModules(previous);
    const modules: Record<string, ModuleExclusion> = { ...prev };
    for (const [key, cur] of Object.entries(this.modules)) {
      const before = continuing.has(key) ? prev[key] : undefined;
      const uids = KEEP_UIDS.has(key) ? [...(before?.uids ?? []), ...this.excludedUids(key)].slice(0, MAX_KEPT_UIDS) : undefined;
      modules[key] = {
        count: (before?.count ?? 0) + cur.count,
        examples: [...new Set([...(before?.examples ?? []), ...cur.examples])].slice(0, 5),
        ...(uids ? { uids } : {}),
      };
    }
    return { updatedAt: new Date().toISOString(), modules };
  }
}

function storedModules(value: unknown): Record<string, ModuleExclusion> {
  return value && typeof value === "object" && "modules" in value ? (value as TestExclusions).modules : {};
}

/** Excluded uids a sync step stored for a module (see KEEP_UIDS). */
export function storedExcludedUids(value: unknown, module: string): string[] {
  return storedModules(value)[module]?.uids ?? [];
}

/** The real records of a page; test records are logged (with their uid) and dropped. */
export function keepReal<T extends Record<string, unknown>>(
  page: T[],
  module: string,
  log: ExclusionLog | undefined,
  uid: (raw: T) => unknown,
  opts?: { ownEmail?: boolean }
): T[] {
  if (!log) return page;
  log.touch(module);
  return page.filter((raw) => {
    const reason = testReason(raw, opts);
    if (!reason) return true;
    const id = uid(raw);
    log.add(module, reason, id == null ? undefined : String(id));
    return false;
  });
}

/** Plain names for the sync modules' keys (catalog module keys are already readable). */
const MODULE_LABELS: Record<string, string> = {
  endCustomers: "customers",
  teams: "team members",
  job_timelogs: "job time logs",
  user_timelogs: "user time logs",
};

export function exclusionModuleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module.replace(/_/g, " ");
}

/** Total records excluded and the modules they came from, e.g. for a report line. */
export function summarizeExclusions(value: unknown): { total: number; byModule: { module: string; count: number; examples: string[] }[] } {
  const byModule = Object.entries(storedModules(value))
    .filter(([, m]) => m.count > 0)
    .map(([module, m]) => ({ module, count: m.count, examples: m.examples }))
    .sort((a, b) => b.count - a.count);
  return { total: byModule.reduce((s, m) => s + m.count, 0), byModule };
}
