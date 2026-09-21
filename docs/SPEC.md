# Zuper Customer Business Review (CBR) Generator — MVP Spec

Internal tool for Zuper CSMs: enter a customer's Zuper API key, pull account
data, compute metrics deterministically, generate AI narrative/recommendations
on top of those computed numbers, and produce an editable, boardroom-ready
QBR or MBR (PDF/PPTX).

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
  QBR
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

- **QBR**: Cover → Executive Summary → Customer Health → Business
  Performance (jobs+invoices+payments) → Technician Performance → Product
  Adoption → Opportunities → Recommendations → Next-Quarter Plan
- **MBR**: Cover → Monthly Performance → KPI Movement → Operational Metrics
  → Issues → Adoption → Recommendations → Next-Month Priorities

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
6. **Report Wizard** — choose QBR/MBR, template, period → creates `Report` + generates all sections
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
