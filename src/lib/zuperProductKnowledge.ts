// Curated Zuper product reference, given to the AI engine as grounding context
// so generated recommendations name real Zuper features/mechanics correctly
// instead of generic SaaS advice. Kept deliberately compact — this is context
// for prompt-grounding, not a marketing document.
//
// The AI is instructed to only recommend something from here if the account's
// computed metrics/opportunity signals actually support it — this file is
// "what Zuper can do", never a substitute for the numbers.

export const ZUPER_PRODUCT_KNOWLEDGE = `
ZUPER PLATFORM REFERENCE (for grounding recommendations — only cite a feature if the account's own data supports it)

CORE MODULES: Jobs (work orders, checklists, photos, dispatch/scheduling), Quotes/Estimates (CPQ proposals, Good-Better-Best tiered pricing), Invoices & Payments, Customers/Organizations/Properties, Technicians & Teams (skills, timesheets, GPS), Inventory & Purchase Orders, Projects, Service Contracts, Job Costing & Profitability.

ADD-ON PRODUCTS (upsell candidates — recommend only when the account's data shows a real gap):
- Zuper Pay: integrated payments (Tap-to-Pay, payment links, card-on-file, ACH). Signal: high payment volume with low/no online-payment share → faster collections, lower fees than a third-party processor.
- Zuper Connect: business calling/texting, IVR, AI call summaries, unified inbox, CSR Agent hosting. Signal: high call/lead volume, missed-call risk, or no unified customer communication.
- Customer Portal: self-service job/invoice/proposal visibility for the account's own customers. Signal: high support-call volume or customer-communication friction.
- Report Builder: drag-and-drop cross-module reporting. Signal: account asking for custom reporting/visibility.
- Zuper Fleet: GPS vehicle tracking tied to dispatch. Signal: multi-vehicle field operations, dispatch-efficiency questions.
- Workflow Builder: trigger-based automation (status changes, notifications, record sync) — no-code, node-based. Signal: manual re-entry across modules, or an account with zero/few active workflows relative to job volume.
- Instant Estimate Widget: website widget giving homeowners real-time pricing, auto-creates leads/jobs in Zuper.
- Job Documents & E-Sign: contracts/change orders filled with job data, signed inside Zuper.

AI AGENTS (Zuper's newest layer — recommend when the account shows the matching operational pain):
- Field Agent: voice-driven checklists, photo/note capture, walkthrough-to-record conversion. Fits accounts with heavy field documentation burden.
- CSR Agent: AI receptionist for overflow/after-hours calls — books inspections, answers FAQs, sends payment links. Requires Zuper Connect. Fits accounts with missed-call risk or seasonal call surges.
- AR Agent (beta): autonomous overdue-invoice collections by phone/text/email. Requires Zuper Pay. Fits accounts with high aged-receivables balances.
- Sales Coach Agent (beta): scores recorded sales calls against a playbook, coaches reps. Fits accounts wanting to standardize close rates across a growing team.
- Zuper Sense: plain-English Q&A over the account's own operational data plus weather/reputation intelligence; described as an "always-on" layer, not a separate purchase.

QUOTE/CPQ MECHANICS: Standard templates are fixed-price; CPQ templates support formulas, conditional rules, and tiered Good/Better/Best options — a low quote-acceptance rate combined with only single-option (non-CPQ) quotes is a specific, well-grounded CPQ upsell signal.

COMMON, DATA-GROUNDED OPPORTUNITY PATTERNS:
- Large payment volume, low online/digital payment share → Zuper Pay.
- High job/estimate volume, zero or very few active workflows → Workflow Builder (manual-re-entry reduction).
- High invoice aging (60+/90+ day buckets) → Zuper Pay + AR Agent (once Pay is active).
- Low quote acceptance rate with meaningful quote volume → CPQ / Good-Better-Best proposals, automated follow-up reminders (needs Connect).
- Technician workload heavily concentrated in a few people → hiring/rebalancing conversation, not a product pitch.
- Licensed seats with no recent login → renewal-risk conversation (seat utilization), not a feature pitch.
- High-LTV customers with no jobs in the current period → account-management/retention outreach, not a product pitch.

TONE FOR RECOMMENDATIONS: Specific to this account's own numbers, never generic "you should use technology" advice. Every product mention must tie to a computed metric or rule match actually present in the input — if the data doesn't support a pitch, don't make one.
`.trim();
