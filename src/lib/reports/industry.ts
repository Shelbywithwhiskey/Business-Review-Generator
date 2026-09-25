import type { WebsiteContext } from "@/lib/website";

// ---------------------------------------------------------------------------
// Industry lens: which trade the account is in, detected from its website,
// job categories, line items and name — and, per trade, which of the metrics
// this tool computes matter most and which Zuper capabilities fit. The
// playbook is qualitative on purpose: no benchmark numbers are asserted
// (SPEC §14.7 — don't invent comparisons); the account's own figures are
// placed next to each "what matters" line by the slide.
// ---------------------------------------------------------------------------

export type MetricKey =
  | "quoteAcceptance"
  | "staleQuotes"
  | "callAnswerRate"
  | "missedCalls"
  | "onTime"
  | "recurringShare"
  | "collectionRate"
  | "daysToPay"
  | "onlinePayShare"
  | "workflowHealth"
  | "jobGrowth"
  | "repeatCustomers"
  | "cycleTime"
  | "backlog"
  | "organizations";

export interface IndustryPlay {
  feature: string;
  why: string;
}

export interface IndustryProfile {
  key: string;
  label: string;
  /** One line on how businesses in this trade typically run. */
  model: string;
  /** Ordered: the metrics that matter most in this trade, with why. */
  whatMatters: { metric: MetricKey; why: string }[];
  plays: IndustryPlay[];
  seasonality: string | null;
}

interface IndustryDef extends IndustryProfile {
  keywords: RegExp[];
}

const INDUSTRIES: IndustryDef[] = [
  {
    key: "roofing",
    label: "Roofing & exteriors",
    keywords: [/roof/i, /shingle/i, /siding/i, /gutter/i, /exterior/i, /storm damage/i, /hail/i, /skylight/i],
    model: "Inspection-led sales (often insurance-driven) feeding scheduled production crews; long sales cycles and big tickets.",
    whatMatters: [
      { metric: "quoteAcceptance", why: "big-ticket proposals — every point of close rate is significant revenue" },
      { metric: "staleQuotes", why: "homeowners go quiet; follow-up discipline decides who wins the job" },
      { metric: "missedCalls", why: "storm surges bring call spikes — a missed call is a lost inspection" },
      { metric: "cycleTime", why: "time from signed contract to finished roof drives cash flow and reviews" },
    ],
    plays: [
      { feature: "CPQ proposals (Good-Better-Best)", why: "tiered roof/siding options lift average ticket and close rate" },
      { feature: "CSR Agent + Zuper Connect", why: "answers storm-surge and after-hours calls and books inspections" },
      { feature: "Workflow Builder", why: "automates the inspection → estimate → production hand-offs" },
      { feature: "Zuper Pay", why: "deposits and final payments by link instead of checks" },
    ],
    seasonality: "Storm and weather driven — expect call and job spikes after severe weather.",
  },
  {
    key: "pool_spa",
    label: "Pool & spa service",
    keywords: [/\bpool/i, /\bspa\b/i, /hot tub/i, /chlorin/i],
    model: "Recurring weekly/bi-weekly maintenance routes plus repair and seasonal openings/closings.",
    whatMatters: [
      { metric: "recurringShare", why: "route-based maintenance is the recurring-revenue backbone" },
      { metric: "onTime", why: "missed visits mean green pools and churn" },
      { metric: "onlinePayShare", why: "autopay/card-on-file keeps route revenue flowing without chasing" },
      { metric: "repeatCustomers", why: "retention of maintenance customers is the growth engine" },
    ],
    plays: [
      { feature: "Recurring jobs & routes", why: "dense routes and automatic visit creation" },
      { feature: "Zuper Pay (card on file)", why: "automatic billing for maintenance plans" },
      { feature: "Customer Portal", why: "customers see visit reports and pay without calling" },
    ],
    seasonality: "Strong seasonal peaks (openings in spring, closings in fall) in most regions.",
  },
  {
    key: "water_treatment",
    label: "Water treatment & purification",
    keywords: [/water treatment/i, /softener/i, /filtration/i, /reverse osmosis/i, /purif/i, /\bro\b system/i, /\bpure\b/i, /preventa?tive maintenance/i, /\bunit removal\b/i],
    model: "Equipment installs followed by long-running preventative-maintenance and service relationships.",
    whatMatters: [
      { metric: "recurringShare", why: "preventative maintenance is the recurring revenue after the install" },
      { metric: "onTime", why: "maintenance and service visits on schedule keep units — and contracts — healthy" },
      { metric: "jobGrowth", why: "installed base growth sets next year's service volume" },
      { metric: "collectionRate", why: "high-volume, lower-ticket service billing needs tight collections" },
    ],
    plays: [
      { feature: "Service contracts & recurring jobs", why: "auto-schedule PM visits for every installed unit" },
      { feature: "Assets", why: "track each unit's install, service history and warranty" },
      { feature: "Zuper Pay", why: "card-on-file for recurring service billing" },
    ],
    seasonality: null,
  },
  {
    key: "hvac",
    label: "HVAC",
    keywords: [/hvac/i, /heating/i, /cooling/i, /air condition/i, /furnace/i, /heat pump/i, /duct/i],
    model: "Emergency service, replacements and maintenance agreements; highly seasonal demand.",
    whatMatters: [
      { metric: "missedCalls", why: "no-heat/no-cool calls go to whoever answers first" },
      { metric: "recurringShare", why: "maintenance agreements smooth seasonality and feed replacements" },
      { metric: "quoteAcceptance", why: "replacement quotes are the big-ticket revenue" },
      { metric: "onTime", why: "same-day response is the customer's measure of service" },
    ],
    plays: [
      { feature: "CSR Agent + Zuper Connect", why: "answers peak-season and after-hours calls" },
      { feature: "Service contracts", why: "maintenance agreements with automatic visits" },
      { feature: "CPQ proposals", why: "Good-Better-Best replacement options" },
    ],
    seasonality: "Peaks in summer and winter; shoulder seasons are for maintenance.",
  },
  {
    key: "plumbing",
    label: "Plumbing & drain",
    keywords: [/plumb/i, /drain/i, /sewer/i, /water heater/i, /backflow/i],
    model: "Emergency and scheduled service calls, with installs and replacements.",
    whatMatters: [
      { metric: "missedCalls", why: "emergency calls convert to whoever answers" },
      { metric: "onTime", why: "response time is the service promise" },
      { metric: "daysToPay", why: "on-site collection keeps cash tight on high call volume" },
      { metric: "quoteAcceptance", why: "replacement and repipe quotes are the big tickets" },
    ],
    plays: [
      { feature: "CSR Agent + Zuper Connect", why: "never miss an emergency call" },
      { feature: "Zuper Pay (Tap to Pay)", why: "collect on site when the job is done" },
    ],
    seasonality: null,
  },
  {
    key: "electrical",
    label: "Electrical",
    keywords: [/electric/i, /electrician/i, /wiring/i, /\bpanel/i, /generator/i, /ev charger/i],
    model: "Service calls, installs and project work, often with permits and inspections.",
    whatMatters: [
      { metric: "onTime", why: "inspection and permit timelines make schedule adherence critical" },
      { metric: "quoteAcceptance", why: "project and install quotes drive revenue" },
      { metric: "collectionRate", why: "progress billing on projects needs tight collections" },
      { metric: "cycleTime", why: "job duration drives crew capacity" },
    ],
    plays: [
      { feature: "Projects", why: "multi-visit installs with phases and progress billing" },
      { feature: "Workflow Builder", why: "permit and inspection reminders on status changes" },
    ],
    seasonality: null,
  },
  {
    key: "facility_services",
    label: "Facility services & multi-trade maintenance",
    keywords: [/facilit/i, /janitor/i, /housekeep/i, /handyman/i, /window clean/i, /floor care/i, /property services/i, /commercial clean/i, /maintenance services/i],
    model: "Recurring and on-demand work across many client sites, often delivered through a subcontractor network.",
    whatMatters: [
      { metric: "onTime", why: "SLA adherence across sites is what clients renew on" },
      { metric: "organizations", why: "a few large B2B clients usually drive most of the volume" },
      { metric: "collectionRate", why: "high invoice volume across clients needs disciplined collections" },
      { metric: "workflowHealth", why: "automation carries dispatch and client updates at this scale" },
    ],
    plays: [
      { feature: "Customer Portal", why: "clients see service status and invoices per site" },
      { feature: "Work orders & subcontractors", why: "dispatch to the subcontractor network inside Zuper" },
      { feature: "Workflow Builder", why: "client notifications and SLA escalations automatically" },
    ],
    seasonality: null,
  },
  {
    key: "low_voltage",
    label: "Communications, security & low-voltage",
    keywords: [/communication/i, /two.?way radio/i, /telecom/i, /low.?voltage/i, /security/i, /alarm/i, /access control/i, /camera|cctv/i, /cabling/i, /programming/i, /\bradio/i],
    model: "Equipment sales and installations with ongoing repair, programming and service work.",
    whatMatters: [
      { metric: "onTime", why: "installs and repairs on schedule keep client operations running" },
      { metric: "quoteAcceptance", why: "sales orders and install quotes drive revenue" },
      { metric: "backlog", why: "in-house repair and programming queues decide turnaround" },
      { metric: "collectionRate", why: "B2B billing across many orders needs tight follow-up" },
    ],
    plays: [
      { feature: "Assets", why: "track installed equipment, programming and service history" },
      { feature: "Service contracts", why: "recurring service and support agreements" },
      { feature: "Workflow Builder", why: "status updates to clients as repairs move through the shop" },
    ],
    seasonality: null,
  },
  {
    key: "delivery_install",
    label: "Product delivery & installation",
    keywords: [/deliver/i, /assembl/i, /sauna/i, /installation/i, /\bcube\b/i, /\bbarrel\b/i],
    model: "Scheduled delivery and assembly of manufactured products, often by contracted installer crews.",
    whatMatters: [
      { metric: "onTime", why: "delivery and assembly dates are the customer promise" },
      { metric: "cycleTime", why: "order-to-install time drives customer experience and cash" },
      { metric: "jobGrowth", why: "installation volume tracks product sales" },
      { metric: "workflowHealth", why: "automated customer updates cut 'where's my order' calls" },
    ],
    plays: [
      { feature: "Workflow Builder", why: "automatic delivery-window and completion updates to customers" },
      { feature: "Customer Portal", why: "customers track their installation without calling" },
      { feature: "Routes", why: "sequence deliveries by region to cut mileage" },
    ],
    seasonality: null,
  },
  {
    key: "solar",
    label: "Solar & energy",
    keywords: [/solar/i, /photovoltaic/i, /\bpv\b/i, /battery storage/i],
    model: "Consultative sales, permitting and multi-stage installs, then monitoring and service.",
    whatMatters: [
      { metric: "quoteAcceptance", why: "long consultative sales cycles" },
      { metric: "cycleTime", why: "sale-to-interconnection time is the big lever" },
      { metric: "staleQuotes", why: "proposals stall without follow-up" },
      { metric: "collectionRate", why: "milestone billing" },
    ],
    plays: [
      { feature: "Projects", why: "multi-phase installs with milestones" },
      { feature: "CPQ proposals", why: "system-size and financing options" },
    ],
    seasonality: null,
  },
];

const GENERIC: IndustryProfile = {
  key: "field_service",
  label: "Field service",
  model: "Scheduled and on-demand field work, quoted, dispatched, completed and billed.",
  whatMatters: [
    { metric: "onTime", why: "doing the work when promised is the core service promise" },
    { metric: "quoteAcceptance", why: "quotes that close are the revenue pipeline" },
    { metric: "collectionRate", why: "getting paid for completed work" },
    { metric: "missedCalls", why: "unanswered calls are lost work" },
  ],
  plays: [
    { feature: "Workflow Builder", why: "removes manual hand-offs between office and field" },
    { feature: "Zuper Pay", why: "faster collection" },
  ],
  seasonality: null,
};

export interface IndustryEvidence {
  website: WebsiteContext | null;
  customerName: string;
  jobCategories: { name: string; count: number }[];
  lineItemNames: string[];
}

export interface IndustryResult extends IndustryProfile {
  confidence: "high" | "medium" | "low";
  /** What the detection was based on, for the notes. */
  signals: string[];
  /** Services the website and job categories mention (display). */
  services: string[];
}

export function detectIndustry(e: IndustryEvidence): IndustryResult {
  const webText = e.website ? `${e.website.title ?? ""} ${e.website.description ?? ""} ${e.website.excerpt}` : "";
  const totalJobs = e.jobCategories.reduce((s, c) => s + c.count, 0) || 1;
  const scored = INDUSTRIES.map((ind) => {
    let score = 0;
    const hits = new Set<string>();
    for (const re of ind.keywords) {
      const web = (webText.match(new RegExp(re.source, "gi")) ?? []).length;
      if (web) hits.add(`website: "${webText.match(re)![0]}"`);
      score += Math.min(web, 6);
      // Job categories weigh by how much of the work they represent.
      for (const c of e.jobCategories) if (re.test(c.name)) {
        score += 12 * (c.count / totalJobs) + 2;
        hits.add(`job category "${c.name}"`);
      }
      if (re.test(e.customerName)) {
        score += 5;
        hits.add(`company name "${e.customerName}"`);
      }
      const items = e.lineItemNames.filter((n) => re.test(n)).length;
      if (items) hits.add(`line items (${items})`);
      score += Math.min(items, 3);
    }
    return { ind, score, hits: [...hits] };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  const services = [...new Set(e.jobCategories.slice(0, 5).map((c) => c.name.replace(/[^\p{L}\p{N} &/-]/gu, "").trim()).filter(Boolean))];
  if (!best || best.score < 4) {
    return { ...GENERIC, confidence: "low", signals: ["no strong trade keywords found — using the general field-service lens"], services };
  }
  const confidence = best.score >= 12 && best.score >= second.score * 1.5 ? "high" : best.score >= 7 ? "medium" : "low";
  const { keywords: _k, ...profile } = best.ind;
  void _k;
  return { ...profile, confidence, signals: best.hits.slice(0, 6), services };
}
