# Zuper Customer Business Review (CBR) Generator — Customer Value Spec

Internal tool for Zuper CSMs: enter a customer's Zuper API key, pull account
data and approved baseline evidence, compute metrics deterministically, and
produce an editable EBR, QBR, HBR, or MBR (PDF/PPTX) showing the customer's
progress against agreed business goals and the supported contribution of Zuper.
AI writes narrative/recommendations from computed evidence.

**Customer-value revision — 2026-09-23:** Section 14 defines the required
measurement and extraction behavior. Its customer-value requirements take
precedence over the original MVP's generic activity reporting, health-score,
and product-opportunity defaults. This document describes the intended build;
the uploaded files do not include the connector, analytics implementation,
database schema file, or account data needed to verify or implement runtime changes.

Core rule baked into the architecture: **the app calculates every number.
The AI only interprets numbers it is handed — it never computes or invents
one.** See [AI Engine](#6-ai-engine--prompts).

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | Shared types between web/worker/packages |
| Frontend | Next.js 15 (App Router) + TypeScript | API routes double as backend, one deploy target |
| UI | Tailwind CSS + shadcn/ui | Fast, consistent, themeable (needed for branded reports) |
| Charts | Recharts | Matches dataviz skill guidance, good React fit |
| Drag-and-drop | dnd-kit | Template editor section reordering |
| Backend API | Next.js Route Handlers (REST) | No separate service needed for MVP |
| Background jobs | BullMQ + Redis | Zuper syncs are slow/rate-limited; must be async with retry |
| Database | PostgreSQL + Prisma ORM | Relational data (customers, jobs, invoices, reports) |
| Auth | NextAuth (Credentials or Google Workspace SSO) | Internal CSM login only |
| Secrets | AES-256-GCM envelope encryption via KMS (or `age` locally in dev) | Customer API keys are sensitive credentials |
| AI | Anthropic Claude API (Sonnet) via Messages API, structured (tool-call) output | Structured JSON out, cheap enough for narrative gen |
| PDF export | Playwright (render report HTML → PDF) | Pixel-accurate, reuses the web report layout |
| PPTX export | `pptxgenjs` | Native PPTX, editable in PowerPoint |
| Hosting (MVP) | Vercel (web) + Railway/Render (worker, Postgres, Redis) | Fast to stand up, scales later |

---

## 2. Architecture

```
Web App (Next.js)
 ├─ Customer setup / API key vault
 ├─ Analyze Account trigger  ──────────────┐
 ├─ Template Editor (drag & drop)          │
 ├─ Report Editor (WYSIWYG sections)       │
 └─ Export (PDF / PPTX / share link)       │
                                            ▼
                                   BullMQ Queue (Redis)
                                            │
                                            ▼
                                  Worker (background jobs)
                                            │
                     ┌──────────────────────┼───────────────────────┐
                     ▼                      ▼                       ▼
           zuper-connector          analytics-engine            ai-engine
           (pulls + normalizes      (deterministic KPIs,        (Claude API,
            Zuper API data)          comparisons, rankings,      narrative +
                                      health score, rule-based    recommendations,
                                      opportunity signals)        structured output)
                     │                      │                       │
                     └──────────────────────┴───────────────────────┘
                                            │
                                            ▼
                                     PostgreSQL (Prisma)
                                            │
                                            ▼
                                    report-builder
                             (assembles Report + Sections,
                              renders HTML → PDF/PPTX)
```

**Data flow contract:** `zuper-connector` → raw normalized rows in Postgres →
`analytics-engine` computes every KPI/comparison/ranking as plain numbers
stored in `MetricSnapshot` → `ai-engine` receives *only* that computed JSON
(never raw API payloads) and returns narrative text → `report-builder`
assembles the final report from computed numbers + AI text.

---

## 3. Database Schema (Prisma)

```prisma
// packages/db/prisma/schema.prisma

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  role      Role     @default(CSM)
  customers Customer[] @relation("CustomerOwner")
  createdAt DateTime @default(now())
}

enum Role {
  CSM
  ADMIN
}

model Customer {
  id             String   @id @default(cuid())
  name           String
  zuperAccountId String
  ownerId        String
  owner          User     @relation("CustomerOwner", fields: [ownerId], references: [id])
  notes          String?
  createdAt      DateTime @default(now())

  credential     ApiCredential?
  syncRuns       SyncRun[]
  jobs           Job[]
  invoices       Invoice[]
  technicians    Technician[]
  payments       Payment[]
  quotes         Quote[]
  appointments   Appointment[]
  metricSnapshots MetricSnapshot[]
  reports        Report[]
  opportunitySignals OpportunitySignal[]
  healthScores   HealthScore[]
}

model ApiCredential {
  id               String   @id @default(cuid())
  customerId       String   @unique
  customer         Customer @relation(fields: [customerId], references: [id])
  encryptedApiKey  String   // AES-256-GCM ciphertext
  baseUrl          String   @default("https://api.zuper.co")
  lastVerifiedAt   DateTime?
  createdAt        DateTime @default(now())
}

model SyncRun {
  id          String   @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  periodStart DateTime
  periodEnd   DateTime
  modules     String[] // ["jobs","invoices","technicians",...]
  status      SyncStatus @default(PENDING)
  errorMessage String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime @default(now())
}

enum SyncStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
}

// ---- Normalized Zuper data (Phase 1 modules) ----

model Job {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  zuperJobId    String
  status        String   // completed | cancelled | open | in_progress
  serviceType   String?
  location      String?
  technicianId  String?
  jobValue      Decimal?
  createdAt     DateTime
  completedAt   DateTime?
  scheduledAt   DateTime?
  syncRunId     String

  @@index([customerId, createdAt])
  @@unique([customerId, zuperJobId])
}

model Invoice {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  zuperInvoiceId String
  status        String   // draft | sent | paid | overdue | void
  amount        Decimal
  amountPaid    Decimal  @default(0)
  issuedAt      DateTime
  dueAt         DateTime?
  paidAt        DateTime?
  syncRunId     String

  @@index([customerId, issuedAt])
  @@unique([customerId, zuperInvoiceId])
}

model Technician {
  id              String   @id @default(cuid())
  customerId      String
  customer        Customer @relation(fields: [customerId], references: [id])
  zuperUserId     String
  name            String
  jobsCompleted   Int      @default(0)
  revenue         Decimal  @default(0)
  completionRate  Decimal  @default(0)
  avgJobValue     Decimal  @default(0)
  rating          Decimal?
  periodStart     DateTime
  periodEnd       DateTime
  syncRunId       String

  @@unique([customerId, zuperUserId, periodStart, periodEnd])
}

model Payment {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  zuperPaymentId String
  amount        Decimal
  method        String?
  zuperPayUsed  Boolean  @default(false)
  paidAt        DateTime
  syncRunId     String

  @@unique([customerId, zuperPaymentId])
}

model Quote {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  zuperQuoteId  String
  status        String   // created | accepted | rejected
  value         Decimal
  createdAt     DateTime
  syncRunId     String

  @@unique([customerId, zuperQuoteId])
}

model Appointment {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  zuperApptId   String
  status        String   // scheduled | completed | cancelled | no_show
  scheduledAt   DateTime
  syncRunId     String

  @@unique([customerId, zuperApptId])
}

// ---- Computed layer (deterministic — AI never writes here) ----

model MetricSnapshot {
  id                String   @id @default(cuid())
  customerId        String
  customer          Customer @relation(fields: [customerId], references: [id])
  periodStart       DateTime
  periodEnd         DateTime
  metricKey         String   // "jobs.total", "invoices.outstanding_amount", ...
  value             Decimal
  comparisonPeriod  String?  // "previous_period" | "yoy"
  comparisonValue   Decimal?
  changePct         Decimal?
  createdAt         DateTime @default(now())

  @@index([customerId, periodStart, periodEnd, metricKey])
}

model HealthScore {
  id              String   @id @default(cuid())
  customerId      String
  customer        Customer @relation(fields: [customerId], references: [id])
  reportId        String?
  overallScore    Int
  dimensionScores Json     // { productAdoption: 82, operationalUsage: 91, ... }
  createdAt       DateTime @default(now())
}

model OpportunitySignal {
  id            String   @id @default(cuid())
  customerId    String
  customer      Customer @relation(fields: [customerId], references: [id])
  reportId      String?
  type          String   // "zuper_pay" | "zuper_ai" | "custom_reports" | ...
  score         String   // "low" | "medium" | "high"
  evidence      Json     // { paymentVolume: 428000, zuperPayEnabled: false }
  narrative     String?  // AI-written justification
  createdAt     DateTime @default(now())
}

// ---- Report layer ----

model ReportTemplate {
  id          String   @id @default(cuid())
  name        String
  type        ReportType
  sections    Json     // ordered array of SectionConfig (see §7)
  isDefault   Boolean  @default(false)
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

enum ReportType {
  EBR
  QBR
  HBR
  MBR
}

model Report {
  id           String   @id @default(cuid())
  customerId   String
  customer     Customer @relation(fields: [customerId], references: [id])
  templateId   String
  type         ReportType
  periodStart  DateTime
  periodEnd    DateTime
  compareMode  String?  // "previous_period" | "yoy" | "none"
  status       ReportStatus @default(DRAFT)
  shareToken   String?  @unique
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  sections     ReportSection[]
}

enum ReportStatus {
  DRAFT
  FINAL
}

model ReportSection {
  id               String   @id @default(cuid())
  reportId         String
  report           Report   @relation(fields: [reportId], references: [id])
  sectionKey       String   // "jobs_performance", "invoice_performance", ...
  order            Int
  contentJson      Json     // KPI cards / chart data / table rows, computed
  narrativeText    String?  // AI-generated, editable
  recommendationText String?
  isEdited         Boolean  @default(false)
  editedById       String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

---

## 4. Zuper API Connector (`packages/zuper-connector`)

Module-adapter pattern so new endpoints can be added without touching the
sync orchestrator.

```ts
// packages/zuper-connector/src/client.ts
export class ZuperClient {
  constructor(private apiKey: string, private baseUrl: string) {}
  async get<T>(path: string, params?: Record<string, string>): Promise<T> { /* fetch + retry/backoff */ }
}

// packages/zuper-connector/src/modules/jobs.ts
export interface JobModuleAdapter {
  key: "jobs";
  fetch(client: ZuperClient, range: DateRange): AsyncGenerator<RawZuperJob>;
  normalize(raw: RawZuperJob): NormalizedJob; // maps to Prisma Job shape
}

// packages/zuper-connector/src/registry.ts
export const MODULE_REGISTRY: ModuleAdapter[] = [
  jobsModule, invoicesModule, techniciansModule, paymentsModule,
  quotesModule, appointmentsModule,
  // Phase 2: projectsModule, inventoryModule, formsModule, workflowsModule
];
```

- Each adapter owns pagination, rate-limit backoff, and field mapping.
- Customer-value extraction must also preserve cross-module relationships,
  timestamped events, source coverage, and historical state as described in §14.
- `syncZuperData` worker job iterates `MODULE_REGISTRY` (filtered to
  `SyncRun.modules`), upserts normalized rows keyed by
  `(customerId, zuperXId)`, and updates `SyncRun.status`.
- Adding a module later = adding one adapter file + registering it. Nothing
  else in the app changes.
- API key is decrypted only inside the worker process, never returned to the
  frontend after initial entry (write-only field in the UI).

---

## 5. Analytics Engine (`packages/analytics-engine`)

Pure, deterministic, unit-testable — no AI calls in this package.

```
src/
  metrics/
    jobs.ts          // total, completed, cancelled, completion rate, by-month, by-service-type
    invoices.ts       // totals by status, outstanding $, aging buckets, avg invoice value
    technicians.ts     // per-tech rollups, rankings, utilization variance
    payments.ts
    quotes.ts          // conversion rate
    appointments.ts
  comparisons.ts       // diff current vs previous_period / yoy, % change
  rankings.ts           // top-N technicians, sorted rollups
  healthScore.ts         // weighted dimension scoring (see §8)
    opportunityEngine.ts    // rule-based signals (see §9)
    valueEngine.ts          // baseline comparisons, evidence labels, benefit ledger (see §14)
  rulesEngine.ts           // threshold rules that trigger recommendation prompts
```

`rulesEngine.ts` defines named thresholds, e.g.:

```ts
export const RULES = [
  {
    key: "cancellation_rate_increase",
    check: (m: MetricSet) => m.cancellationRateChangePct > 0.15,
    severity: "medium",
  },
  {
    key: "invoice_aging_high",
    check: (m: MetricSet) => m.outstandingOver60Days > 10000,
    severity: "high",
  },
  {
    key: "technician_workload_concentration",
    check: (m: MetricSet) => m.top3TechShareOfJobs > 0.35,
    severity: "medium",
  },
];
```

Every metric written to `MetricSnapshot` is a plain number computed here.
The AI engine is only ever given the *output* of this package.

---

## 6. AI Engine & Prompts (`packages/ai-engine`)

**Hard constraint enforced in code, not just prompt wording:** each prompt's
input is a strict JSON schema of already-computed numbers, and the system
prompt instructs the model to use only those numbers verbatim. A post-gen
validator regex-extracts every number in the AI's output and rejects the
response (retry once, then fall back to a templated sentence) if any number
doesn't appear in the input JSON.

```ts
// packages/ai-engine/src/client.ts
export async function generateSectionNarrative(input: SectionMetrics): Promise<{
  narrative: string;
  recommendation?: string;
}> { /* Claude Messages API call with tool-use forced JSON output */ }
```

**System prompt (shared across all generation calls):**
> You are writing content for a Zuper customer business review (QBR/MBR).
> You will be given a JSON object of pre-computed metrics. Write only about
> numbers present in that JSON, using them exactly as given — never
> calculate, round differently, or invent a number. If a metric needed to
> support a claim isn't in the JSON, don't make the claim. Tone: confident,
> concise, written for an account's stakeholders and Zuper's CSM team.

**Executive summary prompt** — input: full period metrics + comparisons +
health score + top opportunity signals → output: 3–5 sentence narrative.

**Section narrative prompt** (one per section: jobs, invoices, technicians,
quotes, payments, appointments) — input: that section's `SectionMetrics`
JSON → output: 1 short narrative paragraph.

**Recommendation prompt** — input: section metrics + any `rulesEngine`
matches for that section → output: 1–2 sentence actionable recommendation
tied to the specific triggered rule (not generic advice).

**Opportunity narrative prompt** — input: opportunity signal evidence
(e.g., `{ paymentVolume: 428000, zuperPayEnabled: false }`) → output: 2–3
sentence pitch connecting the usage signal to the product gap.

**Technician highlight prompt** — input: ranked technician list + variance
stats → output: strengths + one attention-worthy observation.

All AI output lands in `ReportSection.narrativeText` /
`recommendationText` as **editable, pre-filled text** — the CSM can
overwrite it in the Report Editor, which sets `isEdited = true` and skips
regeneration on that section going forward.

For customer-facing value claims, numeric membership alone is insufficient.
Every claim must reference its computed metric/evidence ID and preserve its
unit, period, cohort, comparison direction, estimation label, and attribution
limits. The AI cannot turn observed activity or a before/after association
into financial savings or a causal claim. See §14 for output restrictions.

---

## 7. Report Builder & Template Editor (`packages/report-builder`)

`ReportTemplate.sections` JSON shape:

```json
[
  {
    "key": "executive_summary",
    "title": "Executive Summary",
    "components": ["narrative"]
  },
  {
    "key": "jobs_performance",
    "title": "Jobs Performance",
    "components": ["kpi_cards", "trend_chart", "status_breakdown_table", "narrative", "recommendation"]
  },
  {
    "key": "invoice_performance",
    "title": "Invoice Performance",
    "components": ["kpi_cards", "revenue_chart", "aging_table", "narrative", "recommendation"]
  }
]
```

`sectionRegistry.ts` maps each `component` type to a renderer used by both
the web editor (React) and the export pipeline (HTML → PDF/PPTX), so the
editor WYSIWYG and the exported file are guaranteed to match.

Default templates seeded at first run:

- **EBR**: Cover → Agreed Business Goals → Value Delivered → Financial and
  Capacity Benefits → Supporting Evidence → Decisions → Joint Success Plan
- **QBR**: Cover → Goals and Progress → Value Delivered → Operational
  Drivers → Relevant Workflow Adoption → Action Review → Next-Quarter Plan
- **HBR** (half-yearly, confirm account terminology): Cover → Goals →
  Six-Month Value Trend → Comparable Seasonal Results → Progress Since
  Previous Commitments → Next-Half Priorities
- **MBR**: Cover → Goal Progress → Operational Drivers → Actions and
  Outcomes → Next-Month Priorities

Store audience (`executive` or `operational`) separately from cadence and
explicit period dates; an executive review may be quarterly or half-yearly.
The legacy report type can select a default template but must not prevent
that combination. Internal renewal risk and sales opportunity sections are
excluded from customer-facing templates by default.

Template editor UI operations (all persisted to `ReportTemplate.sections`):
add/delete/reorder section, rename section, add/remove component within a
section, set template-level branding (logo, colors, fonts), save,
duplicate.

---

## 8. Health Score Model

```ts
// packages/analytics-engine/src/healthScore.ts
const WEIGHTS = {
  productAdoption: 0.25,
  operationalUsage: 0.25,
  financialHealth: 0.20,
  userEngagement: 0.20,
  featureAdoption: 0.10,
};
```

Each dimension is a 0–100 score computed from its own deterministic
sub-metrics (e.g., `financialHealth` derives from on-time-payment rate +
outstanding-balance ratio). Overall score is the weighted sum. Config is a
plain object so weights/formulas can be tuned without touching call sites.

---

## 9. Opportunity Engine

Rule-based detectors, each producing a `low | medium | high` score plus the
evidence used, then handed to the AI engine for narrative only:

| Opportunity | Signal | Example threshold |
|---|---|---|
| Zuper Pay | payment volume processed vs. Zuper Pay enabled flag | volume > $50k/quarter & disabled → high |
| Zuper AI | job volume vs. AI feature usage % | jobs > 500/quarter & AI usage < 20% → high |
| Custom Reports | report exports vs. Custom Report Builder enabled | exports > 50/quarter & disabled → medium |
| Zuper Connect | integration touchpoints vs. Connect enabled | (Phase 2) |

---

## 10. Screens (MVP)

1. **Login** — NextAuth
2. **Dashboard** — customer list, health score chips, last sync date, recent/upcoming reports
3. **Customer Setup** — name, Zuper account ID, API key entry (write-only field), "Test Connection"
4. **Customer Detail** — sync history, raw metrics browser, "Analyze Account" CTA
5. **Analyze Account** — date range, module selection, compare-mode toggle, live sync progress (polls `SyncRun`)
6. **Report Wizard** — choose audience, cadence, template, period, goals, and baseline → creates `Report` + generates supported value sections
7. **Report Editor** — section-by-section WYSIWYG: KPI cards, charts, tables, narrative + recommendation text (editable), "Regenerate with AI" per section
8. **Template Editor** — drag-and-drop section/component builder (dnd-kit), branding controls, save/duplicate
9. **Report Preview / Export** — final render, export PDF/PPTX, generate share link
10. **Settings** — users, default template, brand kit (logo/colors/fonts)

---

## 11. Internal API Endpoints

```
POST   /api/auth/[...nextauth]

GET    /api/customers
POST   /api/customers
GET    /api/customers/:id
PATCH  /api/customers/:id
DELETE /api/customers/:id
POST   /api/customers/:id/credentials
POST   /api/customers/:id/credentials/verify

POST   /api/customers/:id/sync           { periodStart, periodEnd, modules[] }
GET    /api/sync-runs/:id
GET    /api/customers/:id/sync-runs

GET    /api/customers/:id/metrics        ?periodStart&periodEnd&compare=previous_period|yoy
GET    /api/customers/:id/technicians/rankings
GET    /api/customers/:id/opportunities
GET    /api/customers/:id/health-score

GET    /api/templates
POST   /api/templates
GET    /api/templates/:id
PATCH  /api/templates/:id
POST   /api/templates/:id/duplicate
DELETE /api/templates/:id

POST   /api/reports                       { customerId, templateId, periodStart, periodEnd, compareMode }
GET    /api/reports/:id
PATCH  /api/reports/:id
POST   /api/reports/:id/sections/:sectionId/regenerate
PATCH  /api/reports/:id/sections/:sectionId
POST   /api/reports/:id/export            ?format=pdf|pptx
GET    /api/reports/:id/export/:exportId/download
POST   /api/reports/:id/share
GET    /api/shared/:shareToken            (public, read-only render)
```

---

## 12. Folder Structure

```
zuper-cbr-generator/
├── apps/
│   ├── web/                       # Next.js app (UI + API routes)
│   │   ├── app/
│   │   │   ├── (dashboard)/
│   │   │   │   ├── customers/[id]/
│   │   │   │   ├── reports/[id]/
│   │   │   │   ├── templates/[id]/
│   │   │   │   └── settings/
│   │   │   ├── api/
│   │   │   │   ├── customers/
│   │   │   │   ├── sync-runs/
│   │   │   │   ├── reports/
│   │   │   │   ├── templates/
│   │   │   │   └── shared/
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── report-editor/
│   │   │   ├── template-builder/
│   │   │   ├── charts/
│   │   │   └── kpi-cards/
│   │   └── package.json
│   └── worker/                    # BullMQ job processor
│       └── src/jobs/
│           ├── syncZuperData.ts
│           ├── computeMetrics.ts
│           └── generateInsights.ts
├── packages/
│   ├── zuper-connector/
│   │   └── src/{client.ts, registry.ts, modules/}
│   ├── analytics-engine/
│   │   └── src/{metrics/, comparisons.ts, rankings.ts, healthScore.ts, opportunityEngine.ts, rulesEngine.ts}
│   ├── ai-engine/
│   │   └── src/{client.ts, prompts/, schemas.ts, validator.ts}
│   ├── report-builder/
│   │   └── src/{sectionRegistry.ts, exporters/{pdfExporter.ts, pptxExporter.ts}}
│   └── db/
│       └── prisma/schema.prisma
├── docker-compose.yml              # local Postgres + Redis
├── turbo.json
└── package.json
```

---

## 13. Build Order (Phase 1 / MVP)

1. `packages/db` — schema + migrations
2. `packages/zuper-connector` — jobs, invoices, technicians, payments, quotes, appointments modules
3. Sync worker + Customer Setup / Analyze Account screens (get real data flowing end to end)
4. `packages/analytics-engine` — metrics, comparisons, rankings, health score, opportunity/rules engines
5. Dashboard + Customer Detail (surface computed metrics before touching AI)
6. `packages/ai-engine` — narrative/recommendation/opportunity prompts + numeric validator
7. Default QBR/MBR templates (seeded, not yet editable) + Report Wizard + Report Editor
8. `packages/report-builder` — PDF export (PPTX can follow)
9. Template Editor (drag-and-drop) — last, since defaults unblock everything else
10. Share links, PPTX export, branding/settings polish

**Phase 2 (post-MVP):** quotes conversion deep-dive, projects, inventory,
forms/checklists, workflows/automation module, Zuper Connect opportunity
detector, multi-customer portfolio rollups.

---

## 14. Customer Value Measurement and Data Pull Requirements

### 14.1 Purpose and scope

Answer: "What has improved for this customer, what contribution from Zuper
is supported by evidence, and what should improve next?" Select one to three
headline outcomes based on the account's agreed goals. Activity and adoption
are supporting evidence. A module being enabled or processing a large volume
does not establish time savings, incremental revenue, or return on investment.

The application must distinguish:

- **Observed activity:** work or transactions recorded in Zuper.
- **Observed improvement:** a measured change against a comparable baseline;
  other explanations may remain.
- **Estimated benefit:** a modeled result using visible assumptions.
- **Verified financial benefit:** a documented financial result with supported
  attribution and evidence for the claimed cost or margin change.
- **Insufficient data:** a required source, baseline, relationship, or field
  is unavailable. Render the reason; never substitute a zero or an AI estimate.

No account results or savings figures are asserted by this specification.

### 14.2 Account value profile and baseline setup

Before calculating value, capture:

1. Account ID, reporting timezone, currency, business units, service categories,
   billing model, relevant integrations, and permitted data sources.
2. Zuper go-live date and dated rollout/activation records for the specific
   workflows or features being evaluated, including phased team adoption.
3. One to three agreed goals, metric definitions, responsible owners, and
   customer-agreed targets. Avoid universal default savings or health targets.
4. Reporting period and baseline period, baseline source, observation cutoff,
   comparability notes, and historical completeness.
5. Optional validated manual task timings, loaded hourly labor costs, actual
   expense records, subscription costs, implementation costs, and ongoing
   operating costs. Record units, currency, effective dates, and source.
6. Evaluation horizon for quote conversion, collection, and callbacks; local
   SLAs, eligibility rules, exclusions, and original/revised promise rules.

Baseline preference: comparable pre-Zuper records; otherwise a dated feature
rollout with valid prior history; otherwise the earliest stable measured
period, labeled "change since baseline." Pre-Zuper evidence may require an
old-system export or customer-supplied records. Manual estimates are labeled
as assumptions. If no credible baseline exists, show current performance,
establish a baseline, and suppress improvement/ROI claims.

Normalize comparisons for service mix, staffing, working days, seasonality,
and relevant changes in pricing or scope. For phased rollouts, compare similar
teams where suitable; record remaining selection bias. Simple before/after
comparisons support association and do not alone prove causation.

### 14.3 Data extraction plan

The names below are proposed normalized fields, not assertions about Zuper
API response keys. Confirm each mapping from a permitted representative
response or export. Product UI availability does not guarantee API access.

| Source family | Preserve or acquire | Customer value supported |
| --- | --- | --- |
| Jobs and status history | Stable job ID; creation; original and revised schedule/deadline; actual start/completion; dated status changes and holds; category; team; assigned users; end-customer/organization/property/asset IDs; billable scope; parent/return links and reasons | Timeliness, throughput, bottlenecks, callbacks, and billing eligibility |
| Quotes/estimates | Stable quote and revision IDs; sent/accepted/declined/expiry events; valid amount/currency; linked jobs and end customers | Quote response, mature-cohort conversion, and accepted work progression |
| Invoices and allocations | Invoice ID; linked jobs/quotes; issue/due dates; line amounts; taxes/discounts; credits/voids; allocation amounts and event dates | Billing delay, billing completeness, collection performance |
| Payments and adjustments | Transaction and allocation IDs; invoice links; attempt/success/settlement dates where available; status; provider/method; refunds/disputes/reversals; amount/currency | Payment friction, net collections, historical outstanding balances |
| Timelogs, shifts, and time off | Person/job IDs; work/travel intervals; corrections; shift availability; approved leave | Capacity, labor-hour productivity, and travel burden |
| Forms and inspections | Form/template version; applicable conditional requirements; answers; attachments/signatures; completion dates; failure/corrective-action links | Documentation completeness, corrective actions, and reduced rework |
| Workflow and integration logs | Workflow/version; trigger and run IDs; job/record links; retries; unique successful business outcomes; failure/manual-intervention events | Reliable automation and eligible manual steps displaced |
| Product activity and entitlements | Eligible users and roles; dated entitlements/activation; meaningful human actions; integration/service-account identification | Adoption of the workflows expected to deliver the selected goals |
| Assets and contracts | Customer/property/asset links; scheduled service obligations; contract dates, status, renewal history | Preventive-maintenance compliance and recurring-service continuity |
| External/account inputs | Pre-Zuper exports; validated manual timings; payroll/cost evidence; survey results if used; implementation/subscription costs; goals | Baselines, monetary valuation, customer experience, and ROI |

Start with verified permitted Zuper APIs/exports for operational records.
Discover separately whether workflow executions, detailed product activity,
and entitlements are available through account APIs, report exports, or an
authorized internal source. Never infer execution counts from workflow
definitions, logins from job counts, or non-use from a missing permission.

Extractor behavior:

- Pull both reporting and baseline cohorts, all older open work/receivables
  needed for as-of balances, and linked records outside the selected period.
- Include the required lookback and follow-up windows for each metric. Do not
  compare immature current cohorts with fully observed historical cohorts.
- Use pagination, account-specific permissions, rate-limit handling, and
  incremental updates with a documented watermark. Reconcile changed/voided
  records; an upsert of current state is not a historical event ledger.
- Retain account-scoped stable IDs and allocation/association tables for
  many-to-many links. Prevent duplicated amounts when joining jobs, invoices,
  payments, and multiple technicians. Mark unmatched relationships explicitly.
- Record source, fetched/updated times, event cutoff, row counts, missingness,
  eligible sample size, and sync completeness for every measurement.
- Treat unavailable values as null with a reason. Keep currencies separate
  unless a dated, documented conversion method is explicitly configured.

### 14.4 Value metric definitions

Select headline metrics from the customer's goals; the remaining metrics
provide diagnosis. Agree eligibility and observation rules before comparison.

| Metric | Deterministic calculation | Interpretation and guardrail |
| --- | --- | --- |
| Administrative capacity released | Sum over distinct successfully displaced manual steps of `(validated baseline human minutes - current human minutes) / 60` | Estimated hours, unless direct comparable time measurement supports an observed difference. Deduplicate retries and overlapping steps; preserve negative changes as additional effort. Waiting time is not human work time. |
| Timely billing | Eligible jobs whose billing deadline falls in the period and whose required billable scope is covered by valid invoices before that deadline / all eligible jobs with billing deadlines in the period | Includes jobs still uninvoiced when due. Account for deposits, partial billing, credit notes, warranty/nonbillable work, and billing outside Zuper. |
| Completion-to-billing delay | Median and 90th percentile of elapsed time from completion to invoice coverage of the required billable scope | Show billed-cohort size and uninvoiced job count/age alongside the duration. If coverage predates completion, record zero post-completion delay and flag advance billing. If only first-invoice dates exist, label that limited metric explicitly. |
| Collection within the agreed horizon | Allocated net collections received within the agreed interval after issue / collectible amount of invoices in the same fully observed issue cohort | Use dated allocations and adjustments with the agreed credit/refund treatment. Show unpaid invoices; separate invoices, collected cash, and accounting revenue. |
| On-time completion | Eligible jobs completed by the agreed deadline / eligible jobs due in the period | Include overdue unfinished work. Apply documented cancellation rules; retain original promises so schedule changes do not silently improve performance. |
| Callback rate | Eligible completed original jobs with an unplanned same-issue callback within the agreed horizon / eligible original jobs with the full observation horizon | Require reliable links and reasons. Exclude planned multi-visit work, recurring maintenance, and unrelated issues at the same customer/property. Pair with throughput improvements. |
| Labor-hour productivity | Completed comparable work units / corresponding recorded labor hours, using a consistent work cohort and service grouping | Treat incomplete time logging as a coverage limitation. Report work-in-progress effort separately; use comparable categories or agreed workload weights. This measures output per labor hour, not financial savings. |
| Documentation completeness | Eligible jobs meeting every applicable required question/photo/signature requirement at the defined checkpoint / all eligible jobs at that checkpoint | Evaluate conditional branches and template version. Missing documentation can explain delay but does not alone prove it caused the delay. |
| Quote acceptance within the agreed horizon | Distinct eligible sent quotes accepted within the agreed horizon / distinct eligible sent quotes with full follow-up | Deduplicate revisions and use the same cohort/horizon in both periods. Show value separately and preserve pricing/service-mix differences. |
| Workflow adoption | Eligible jobs completing the agreed applicable digital steps / all eligible jobs | Supporting evidence for value. Use human activity records for user engagement and distinguish integration-generated activity. |

For every comparison retain baseline/current numerator, denominator, coverage,
duration distribution where relevant, excluded counts, absolute change, and
relative change. Express rate differences in percentage points. Relative
change is null when the baseline is zero; negative results remain visible.

### 14.5 Monetary valuation and ROI

Maintain a benefit ledger, with one row per independently evidenced benefit,
including source records, period, type, attribution, assumptions, and an
overlap key. Deduplicate benefits before aggregation.

- `estimated capacity value = estimated hours released * validated loaded
  hourly cost`. Label it capacity value. It becomes realized expense savings
  only when actual payroll, overtime, contractor, or other cost records
  demonstrate the reduction with a supported attribution method.
- A lower callback rate can support an estimated avoided-rework scenario:
  `(baseline rate - current rate) * comparable current eligible job count *
  validated cost per callback`. Label the counterfactual assumptions and
  avoid counting the same labor savings in automation/capacity totals.
- Faster collection is a cash-timing benefit. Invoice totals, payment volume,
  outstanding receivables, and cash accelerated are not incremental revenue
  or profit. Potential unbilled work is an opportunity until its outcome is
  documented; it is not realized value already delivered.
- Higher throughput or quote acceptance is an observed operational result.
  Monetizing it requires evidenced incremental work, associated costs/margin,
  attribution, and confirmation it was not merely displaced from another period.
- Calculate realized ROI only when independently verified, non-overlapping
  attributable financial benefits and corresponding Zuper costs are available:
  `(verified attributable financial benefits - total Zuper costs) /
  total Zuper costs * 100`, with a positive cost denominator.
- If a customer requests a modeled ROI, label it as an estimate and expose
  assumptions/sensitivity. Keep modeled capacity value separate from realized
  cash savings. Include subscription, implementation, and ongoing costs on
  the same period basis with any amortization disclosed.

Do not produce a single financial "value delivered" total by adding revenue,
cash collected, capacity value, and expense savings together.

### 14.6 Schema and metric contract additions

Implement these concepts in the actual application after its source/schema
is available; this is a design contract rather than an applied migration:

- `ValueProfile`: account goals, rollout dates, baseline references,
  applicability rules, timezone/currency, and valuation inputs.
- `BaselineReference`: evidence/source, period, measured versus assumed flag,
  owner, comparability notes, and metric-definition version.
- `EndCustomer`, `Organization`, `Property`, `Asset`: preserve the distinction
  from the existing `Customer` model, which denotes the Zuper tenant/account.
- Timestamped operational events, job-user assignments, quote-job links,
  job-invoice allocations, invoice-payment allocations, and adjustments.
- Versioned `ValueMeasurement`: metric ID, account, goal, period/baseline,
  nullable value, unit, numerator/denominator, coverage, source IDs, cutoff,
  method version, evidence classification, attribution limits, and explanation.
- `BenefitLedgerEntry`: amount/hours, currency/unit, valuation assumptions,
  benefit type, period, source links, and overlap/deduplication key.
- `SuccessAction`: prior recommendation, responsible owner, due date, target,
  completion evidence, and measured outcome at the next review.

The legacy `MetricSnapshot.value` non-null decimal is insufficient to encode
missing or non-comparable evidence. Add an appropriate status/nullability
contract; never coerce missing inputs into zero-valued snapshots.

### 14.7 Report and AI output

Each customer-facing value card contains:

`Customer goal -> relevant Zuper workflow -> baseline and current result ->
change -> evidence classification -> source/coverage -> agreed next action`.

The executive opening shows up to three supported outcomes, their baseline
and date range, and progress against the customer's goals. Detail sections
show the operational drivers and adoption that support the interpretation.
Report unresolved goals and deteriorations as well as improvements.

The AI receives only reviewed computed metrics, approved explanatory context,
and assumption metadata. It must:

- Reference a metric/evidence ID for each numeric or benefit claim.
- Preserve numbers, units, periods, cohort rules, estimation labels, and
  attribution limitations. Do not invent comparisons, benchmarks, or savings.
- Describe observational changes as changes since a baseline or as associated
  with adoption. Use causal language only when attribution evidence supports it.
- Explain unavailable evidence and recommend a measurement action where useful.
- Keep internal account-renewal scoring and sales pitches outside the default
  customer-value narrative.

Structured validation must verify each claim against its referenced metric,
including units and comparison meaning. Merely checking whether a number
appears somewhere in the input is insufficient.

### 14.8 Implementation order and acceptance

1. Map actual connector responses and current schema; record field coverage
   and inaccessible sources. Obtain implementation source before coding.
2. Add account goals/baselines and cross-module links. First deliver timely
   billing, on-time completion, and comparable period history where supported.
3. Add measured workflow outcomes and manual-time inputs for capacity-value
   estimates. Enable collection/quality/productivity metrics as evidence permits.
4. Add the benefit ledger, reviewed claim generation, and EBR/QBR/HBR layouts.
5. Reconcile a review against one authorized account's operational evidence
   and customer baseline before presenting account-specific value claims.

Acceptance scenarios must establish that missing baselines suppress savings
claims; old open invoices remain in as-of balances; partial/multiple billing
and payment links do not duplicate value; retries do not inflate automation
benefits; immature callback/quote cohorts are not compared as mature; invalid
or unavailable timelogs do not imply full productivity coverage; negative
changes remain visible; and AI cannot label collections or estimated capacity
as incremental revenue or realized savings.

### 14.9 Source references and limits

Zuper documentation reviewed for capability context on 2026-09-23:

- [Modules and capabilities](https://care.zuper.co/portal/en/kb/articles/zuper-modules-their-capabilities)
- [Job turnaround time](https://care.zuper.co/portal/en/kb/articles/how-to-track-turnaround-time-for-a-job)
- [Job costing and profitability](https://www.zuper.co/job-costing-and-profitability)
- [Get Job Details](https://developers.zuper.co/reference/get-job-details)
- [Get payments](https://developers.zuper.co/reference/get-payments)
- [Get User Timelog Details](https://developers.zuper.co/reference/get-user-timelog-details)

These establish documented capability areas and discovery leads. They do not
verify account permissions, exact field completeness, historical retention,
or the availability of telemetry/execution logs through a particular API.
