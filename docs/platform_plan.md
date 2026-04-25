# Insurance SaaS Platform — End-to-End Build Plan

A planning document for building an agency-grade, multi-tenant SaaS that takes broker-produced placement slips and turns them into a self-serve benefits portal for corporate clients and their employees.

---

## 1. Executive summary

The platform sits between three audiences. Internally, the agency's ops team ingests placement slips (Excel workbooks produced during the broker-insurer negotiation) into a structured, versioned form. A central policy-and-benefits engine stores this structured data, applies eligibility logic, and exposes it through two external surfaces: an HR admin portal for client companies and an employee self-service portal where individual employees see only their own plan. Staging and production exist at two distinct layers — infrastructure (separate environments for the whole stack) and domain (a publish workflow that promotes a draft policy configuration to the live benefit year). Both layers matter and both need to be designed up front.

The defining engineering challenge is not CRUD on employees. It is schema flexibility. Every insurer product (GTL, GHS, GMM, GPA, GCI, GDI, SP, GP, Dental, FWM, GBT, WICI) has a different benefit schedule, different plan structure, and different premium formula. The platform must remain useful whether the client is a three-person clinic with one GHS plan or a 5,000-headcount enterprise with five plans segmented by Hay Job Grade, nationality, and union status. Solving this well is the real product.

## 2. What the uploaded files told me

The three workbooks span the complexity range the platform must handle.

*Balance Medical* is the floor case. One policy, one product family (GHS), one benefit group ("All Employees"), one plan (1 Bedded Private), one insurer (Tokio Marine Life). Annual premium S$1,080 for three headcount. The placement slip fits on half a page.

*CUBER AI Technologies* is the mid case. One policyholding entity, two benefit groups (Senior Management, Corporate Staff), two plans per medical product, and eight products across two insurers (Tokio Marine Life for life and medical, Zurich for personal accident). GTL uses a sum-assured basis for senior management and a multiple-of-salary basis for other staff — already two different calculation models inside one product.

*STMicroelectronics* is the enterprise case and sets the real upper bound. Three separate policyholding legal entities (AP, PTE AMK, PTE TPY) sharing a single master policy. Benefit groups split on three dimensions simultaneously — Hay Job Grade (18 and above, 08–10, 11–17, Bargainable), nationality (Singaporean/PR vs Foreign Worker on Work Permit or S-Pass), and in some cases role (Fire Fighters get an additional cover rider). Five plans under GHS, five insurers across the programme (Great Eastern for life and medical, Zurich for PA, Chubb for business travel, Allianz for WICA). Flex benefits layer on top — employees pick Flex S / M / MC / MC2 based on family composition. Total annual premium runs into the millions.

The Inspro screenshots show what the current client-facing product looks like. The settings page exposes eight tabs (Client Portal, Security, Employee Profile, Dependant Profile, Employee Events, Wallet, Claim, Life Insurance, Medical Insurance, Panel Clinic, Documents, Images, Versions) with a Benefit Year dropdown at the top — "1 May 2025 to 30 Apr 2026 (Current)" — confirming that historical snapshots are first-class. Under each product (Group Hospital and Surgical, Group Major Medical, etc.) there are consistent sub-sections: Product Details, Product Plans, Product Plan Eligibility by Benefit Group, Default Plans by Benefit Group, Group Option Eligibility by Benefit Group, Group Option Restrictions, Default Group Options, Premium Calculation. That structure is the data model — replicate it and extend it.

## 3. The core design challenge: dynamic product schemas

Every product has its own shape. GHS has a fifteen-line schedule of benefits (room and board, ICU, inpatient expenses with sub-items for hospital miscellaneous and surgical fees and daily doctor visits, outpatient, emergency accidental, miscarriage, funeral, ambulance, overseas accidents, community rehab, claim report fees, home nursing, inpatient psychiatric, GST extension). GTL has a much shorter but different structure — death benefit, TPD, family income, terminal illness, extended benefit, repatriation. GPA has a compensation table (accidental death, permanent total disablement, permanent partial disablement by body part). Dental has an annual limit and a list of covered procedures. WICA has statutory minima driven by Singapore's Work Injury Compensation Act.

The wrong move is to build separate tables for each product. You will have a gtl_schedule table, a ghs_schedule table, a gpa_schedule table, and every time a new product variant or new insurer line item appears you are writing a migration. The right move is a hybrid: a fixed relational core for the entities that appear in every product (policy, plan, benefit group, premium rate, eligibility rule) plus a JSONB column holding the product-specific schedule, validated against a JSON Schema that the product catalogue owns. The catalogue itself is data, not code — adding a new product variant becomes a config change, not a deploy.

This approach falls over only if you need heavy querying inside the benefit schedule ("find all employees whose outpatient kidney dialysis limit is below $20,000"). For an agency platform that's a rare need and can be handled with materialised views or search-index projections when it arises.

## 4. Proposed architecture

The diagram above showed three zones — Agency ops, Platform core, Client surface. Here is what lives where.

**Agency ops (staging)** is the workspace where brokers turn placement slips into structured configuration. It has a bulk-import path (upload the Excel workbook, map sheets to products, parse into draft records), a manual-form path (a product-aware wizard that walks through every field the product catalogue requires), and a validation and review stage where a second pair of eyes confirms the configuration before it goes live. Nothing in this zone is visible to end clients. The data stored here is marked as draft — tagged with a version and a policy period but not yet activated.

**Platform core** is the canonical data layer. It holds the product catalogue (what products exist, what fields they require, what their JSON Schema looks like), the policy snapshots (immutable records of what configuration was live for each benefit year), the eligibility engine (the rules that map an employee to their applicable benefit group and from there to their plan), and the enrollment ledger (who is covered, for what, on what dates, with which dependents). This is the layer every other surface reads from. It runs as a headless API — the portals are thin.

**Client surface (production)** is what clients and insurers touch. The HR admin portal lets client HR teams manage their roster, process employee events (new hire, spouse added, marriage, leaver), download census reports for the broker at renewal time, and view claims history. The employee portal lets individuals see their own benefits for the current year, view historical plans, check their dependents, file claims, and see claim status. A claims data feed synchronises with the TPA or insurer (the Inspro screenshots reference IHP for CUBER's panel clinic and TMLS for TMLS-direct feeds) so that claims data flows back into the platform automatically.

The tech choice that matters most here is the database. Postgres is the right answer because of first-class JSONB support, mature tenancy patterns, strong transactional guarantees for the enrollment ledger, and a rich ecosystem for audit trails (which PDPA and MAS requirements will push hard on). On top of that, a typed API layer (Node/TypeScript with tRPC or Python/FastAPI with Pydantic), background jobs for parse and publish workflows (BullMQ, Temporal, or Celery), and a frontend that can run two surfaces off the same design system (Next.js with a shared component library). Object storage (S3 or equivalent) for the original placement slip files, PDFs, and employee documents.

## 5. Data model

Here is a sketch of the core entities. I'm writing them in prose rather than a table because the relationships matter more than the columns.

A *Tenant* represents the broker-agency running the platform — at launch this is just you, but the schema should support multi-agency from day one because it's cheap to add and expensive to retrofit. A *Client* is a corporate customer of the agency (CUBER AI, STMicroelectronics, Balance Medical). A Client can have one or more *PolicyHoldingEntities* — this matters for STM where three legal entities share one programme. A *Policy* belongs to a PolicyHoldingEntity, has a policy number issued by an insurer, belongs to an *Insurer*, and has a *PolicyPeriod* (a start and end date, renewed annually).

Under each Policy sit one or more *Products* — each one is an instance of a product type (GHS, GTL, GPA, etc.) drawn from the *ProductCatalogue*. The Product instance stores its product-type-specific configuration in a JSONB *schedule* field validated against the type's JSON Schema. It also stores common fields as real columns: eligibility age limits, last entry age, non-evidence limit (GTL only), premium currency, administration basis (name vs headcount), calculation type (per group vs per individual), proration type (daily), and GST extension flag.

A Product has one or more *Plans* — for GHS these are the ward tiers ("1 Bed Private", "4 Bed Restructured"), for GTL these are the cover amounts ("300,000 fixed", "12x salary"). A Plan has a name, a plan ID, and either a fixed sum assured or a formula (multiple of salary with min and max). The Plan is where most of the benefit-schedule detail lives, because GHS plan 1 and plan 4 have different room-and-board entitlements, different inpatient caps, etc. Two options here: store the full schedule per Plan (more flexible, more storage), or store a product-level schedule template with plan-level overrides (leaner, harder to query). Start with per-plan storage; optimize only if you actually need to.

A *BenefitGroup* represents a category of employees defined by eligibility predicates (job grade in some set, nationality in some set, age bracket, employment type). Benefit groups are per-Client, not global. The *BenefitGroupEligibility* table joins benefit groups to plans — for each (benefit group, product) pair, which plans are they eligible for and which is the default? This is exactly what the Inspro screenshot labelled "Default Plans - Group Hospital and Surgical" shows.

A *PremiumRate* table stores the rate per unit for each (product, plan, benefit group, coverage option) combination. Coverage option is the EO/ES/EC/EF axis (Employee Only, Employee + Spouse, Employee + Children, Employee + Family). For per-individual products like GTL, rate is per $1,000 sum assured. For per-group products like GHS, rate is a fixed annual premium per coverage option.

An *Employee* belongs to a Client, has a profile (name, NRIC/FIN, date of birth, gender, nationality, employment type, hire date, job grade or category, salary for salary-multiple products), and references a BenefitGroup — the group is computed by applying eligibility predicates to the employee's attributes when they are enrolled, not stored statically, so that a promotion or re-grading automatically moves them to the correct group.

A *Dependent* belongs to an Employee, has its own profile, and has a relationship type (spouse, child). Dependents have their own eligibility rules (spouse up to age 73 in the Balance Medical example, child up to age 25).

An *Enrollment* is the actual coverage record. It joins Employee (and optionally Dependent, for dependent-specific enrollments) to a specific Plan within a Product within a PolicyPeriod, with a coverage option and an effective date range. This is the ledger. Every change — a new hire, a marriage, a child turning 26 and ageing out — is a new Enrollment row, not an update. This is the table claims adjudication reads from, the table premium billing reads from, and the table the employee portal reads from to answer "what am I covered for".

For publishing, a *PolicyVersion* sits above the Policy + Product + Plan + BenefitGroup hierarchy. It has a status (draft, in_review, published, superseded) and an effective benefit year. When the broker finalises configuration for the 2026 policy year, they publish the draft — this transitions the version to `published` and freezes the configuration. Employees see the published version only. This is the in-app staging-to-production boundary.

Every table carries created_at, updated_at, created_by_user_id, and an audit trigger that writes every change to a history table. This is not optional under PDPA — you must be able to show who accessed and changed what.

## 6. Placement slip ingestion workflow

The placement slips in your files are structured Excel workbooks with one sheet per product (`GTL`, `GHS`, `GMM`, `SP`, `GPA`, `GBT`, `WICI`). The sheet structure is consistent across the three client examples — same labelled rows (Policyholder, Insured, Period of Insurance, Insurer, Policy No., Eligibility, Basis of Cover table, Rate table, Schedule of Benefits). This is not machine-readable by design, but it is parseable.

The ingestion flow goes like this. The broker uploads the workbook. A parser reads each sheet, detects the product type from the sheet name and the header row, and extracts the known fields (policyholder, insurer, period, eligibility, last entry age, basis of cover grid, rate grid). It handles the schedule of benefits by matching row labels against a product-type-specific template — for GHS it looks for "Daily Room & Board", "Intensive Care Unit", "In-patient Expenses", etc. Anything it can't match with high confidence gets flagged for manual review rather than silently dropped.

The output is a *draft PolicyVersion* — a tree of draft Policy, Product, Plan, BenefitGroup, and PremiumRate records, all tagged with the same version ID and marked `draft`. The broker then opens this draft in the agency portal and sees a diff-style view: what was extracted, what needs confirmation, what's missing. They can edit inline. When they're happy, they submit for review. A second broker approves. On approval, the version becomes `in_review` then `published`.

The parser does not have to be perfect. It has to be honest — never quietly make up a value, always flag uncertainty, and always preserve the original source file in object storage with a reference from the draft so there's a single source of truth if something is disputed later.

For the manual path, the form builder is just the same underlying data model exposed through a product-type-aware wizard. New product variants (a new insurer introducing a new benefit line) are handled by editing the product catalogue's JSON Schema — no code change needed.

## 7. Staging and production — the two layers

When you said staging and production in your brief, you may have meant either of two things, and the platform needs both.

*Infrastructure staging* is a separate deployed copy of the whole stack — staging.yourplatform.com running the same code against a staging database with synthetic or anonymised production data. This is where you test new releases before rolling to production. Standard web engineering practice. It becomes mandatory the moment you have paying clients because you cannot ship a buggy enrollment engine to live policies.

*Domain staging* is the in-app draft-to-published lifecycle for policy configurations. Inside the production environment itself, a new benefit year's policy sits as a `draft` PolicyVersion that employees cannot see. Broker ops configures, reviews, and publishes it in place. This is what the Inspro Benefit Year dropdown enables — at any moment there may be a published "2025-2026 (Current)" version and a draft "2026-2027" version being built for the upcoming renewal. On renewal day, the new version becomes current and the old one becomes historical. Employees see the version applicable to the date range they're asking about.

You need both. Infrastructure staging protects against code regressions. Domain staging protects against configuration mistakes while letting brokers work continuously on next year's programme without disrupting this year's users.

## 8. Client-facing portal experience

The HR admin portal is the lower-stakes surface. HR at the client company needs to see their full roster, add new hires, mark leavers, process employee events (marriage, new child, divorce, death), upload supporting documents, pull a census report for the broker, see aggregate utilisation statistics, and (in more mature builds) directly enter claims or upload claim supporting documents. It sees the client's full dataset — all employees, all plans — scoped by a tenant boundary.

The employee portal is the higher-stakes surface because it is the one that touches personal data of thousands of individual people. Each employee, on login, sees only their own record and their own dependents. They can view their current coverage under each product in plain language ("You are covered for hospitalisation in a 1 Bedded Private room, up to $25,000 per disability for inpatient expenses"), view the full schedule of benefits as a reference, see their dependents and their cover, check claim status, submit a claim (where supported), view panel clinics and specialists, and download their e-card. This is where the schedule-of-benefits JSON gets rendered into human-readable explanations — ideally with a per-product display template so that the presentation improves over time without changing the data.

Both portals should reuse the same API and the same design system. The difference is scope (a tenant-scoped query vs a self-scoped query) and permissions.

## 9. Integrations: insurers and TPAs

The Inspro settings screenshot shows fields for "Enable Insurance Claim" and "Insurance Claim Data Feed", with the feed value set to "SG TM (IHP)" for CUBER and "SG TM (TMLS)" for Balance Medical. This tells us the platform already supports multiple TPA feed types. Each insurer or TPA has its own integration pattern — some push nightly CSVs to SFTP, some expose a REST API, some require the broker to poll. A single *InsurerIntegration* abstraction with adapters per feed type keeps this sane. New feeds become new adapters.

The data flowing back from TPAs is primarily claims activity — claim filed, claim under review, claim paid, claim amount. This lands in a *Claim* table linked to the Employee (or Dependent) and the covering Enrollment. The employee portal reads from this table. The HR portal can aggregate from this table. Utilisation reports for renewal negotiations run off this table.

Outbound, the platform sends census files to insurers at renewal time and throughout the year as employee movements occur. These are standardised formats (each insurer has theirs). Generate them from the enrollment ledger, never from the roster — because the ledger reflects actual coverage on specific dates, whereas the roster only reflects the current state.

## 10. Security and compliance

Singapore's PDPA governs this platform's handling of personal data and the bar is meaningful. Employee NRIC, date of birth, salary, medical claim history, and dependent data all count as personal data and the medical data specifically is sensitive. Key requirements include purpose limitation (collect only what's needed for the stated benefits administration purpose), data minimisation (don't show an HR admin the exact claim diagnosis if they only need to see status), retention limits (define how long historical benefit-year data is kept and implement automated purge), access controls with audit (every access to an employee record must be logged), breach notification processes, and data subject access rights (an employee can request export of their data).

For the agency specifically, MAS guidance on insurance brokers covers secrecy of client information. For anything touching financial product recommendations or advice, additional restrictions apply, though a benefits administration platform that's downstream of a placed policy usually stays clear of the regulated-advice line.

Practically, this translates to Postgres row-level security or equivalent application-layer tenant isolation, encryption at rest and in transit, SSO for HR admin users (most corporates expect SAML or OIDC), 2FA for broker ops users, full audit trail on every read and write of employee data, and documented data retention policies. The `sg-enterprise-security` skill in this project has more detail and should be consulted at PRD-signoff, architecture review, and pre-production code review.

## 11. Product mapping reference

This table summarises what the platform needs to handle for each product. Keep it alongside the product catalogue as the canonical list of what's in scope.

| Code | Product | Category | Typical basis | Schedule complexity | Premium basis |
|------|---------|----------|---------------|---------------------|---------------|
| GTL | Group Term Life | Life | Sum assured (fixed or multiple of salary) | Low — death, TPD, terminal illness, family income, repatriation | Per individual, rate per $1,000 SA |
| GCI / GDD | Group Critical Illness / Dread Disease | Life | Sum assured (often rider to GTL) | Medium — fixed list of dread diseases (typically 37) | Per individual, rate per $1,000 SA |
| GPA | Group Personal Accident | Life | Multiple of salary or fixed | Medium — AD&D schedule by body part | Per individual or per group |
| GDI | Group Disability Income | Life | Percent of salary, monthly benefit | Medium — elimination period, benefit period, waiver of premium | Per individual |
| GHS | Group Hospital and Surgical | Health | Plan tier (ward class) | High — 15+ benefit line items | Per group per coverage option |
| GMM | Group Major Medical | Health | Sits on top of GHS | High — secondary layer above GHS with deductible and co-insurance | Per group per coverage option |
| FWM | Foreign Worker Medical | Health | Statutory plus enhancements | Medium — MOM-mandated minimum plus employer top-up | Per individual |
| GP | Group Clinical GP | Health | Panel-based | Medium — per-visit limits for panel, non-panel, TCM, A&E, teleconsult | Per individual, annual premium |
| SP | Group Clinical Specialist | Health | Panel-based, referral-driven | Medium — specialist, X-ray/lab, advanced scans, physio | Per individual, annual premium |
| Dental | Group Dental | Health | Annual limit | Low — list of covered procedures, single annual limit | Per individual, annual premium |
| GBT | Group Business Travel | Other | Per-trip or annual | Medium — medical, evacuation, baggage, trip delay | Per individual or per group |
| WICI / WICA | Work Injury Compensation | Statutory | Headcount + salary band | Low — statutory schedule per Work Injury Compensation Act | Per group, headcount basis |

The complexity column drives how much of that product's configuration is stored as structured columns versus JSONB schedule — higher complexity leans more on JSONB.

## 12. Phased roadmap

A realistic sequence is to build the boring spine first and layer product-specific features after.

*Phase 1 (foundation, roughly 2–3 months)* is the single-tenant MVP for one pilot client, probably Balance Medical given it's the simplest. Build the tenant, client, policy, product-catalogue-for-GHS-only, plan, benefit group, and employee models. Build the manual form builder, not the Excel importer yet. Build the employee portal with a single product view. Skip the claims feed entirely and show claim submission as a mailto link to the broker. Goal: prove the data model and get a real employee looking at their real benefits on your platform.

*Phase 2 (breadth, 2–3 months)* adds the second product family (GTL) and then the remaining life products (GCI, GPA, GDI), plus the HR admin portal. Build the Excel importer for the placement slip format — this is where the CUBER AI workbook gets added as a pilot. Introduce the benefit-year versioning and the draft-to-publish workflow. Expose historical benefit years in the employee portal.

*Phase 3 (depth, 2–3 months)* adds the remaining medical products (GMM, FWM, GP, SP, Dental), the enterprise complexity features — multi-entity policyholders, Hay Job Grade-style benefit groups with compound eligibility predicates, flex benefits — and starts on the TPA claims feed. This is where STM becomes possible as a client.

*Phase 4 (polish, ongoing)* covers renewal automation (the broker renews twenty clients a year with substantially the same structure — automate the first pass), insurer integration breadth (more TPA adapters, direct insurer census uploads), employee mobile app, and an analytics layer for utilisation and renewal pricing support.

At each phase gate, run the full security review against the `sg-enterprise-security` skill checklist before anything goes to production with live client data.

## 13. Open questions to resolve before build

A few things the brief and the files don't fully answer, and which change the design noticeably.

Are you replacing Inspro or building alongside it? The screenshots suggest Inspro is either an existing product you're planning to replace, a competitor you're benchmarking, or a current system you're evolving. The answer changes migration strategy.

How are claims actually flowing today? The Inspro "Insurance Claim Data Feed" setting references IHP and TMLS — do you already have integration relationships with these TPAs, or will each new insurer need a fresh integration?

What's the broker team's existing workflow? If they're comfortable in Excel and won't abandon it, the Excel importer becomes the primary path and the form builder is secondary. If they want to stop using Excel, invest more in the form builder.

How much employee self-service do you actually want? Pure view-only is simpler and lower-risk. Allowing employees to make flex benefit selections or submit claims is higher-value but opens a larger compliance and UX surface.

Single agency or multi-agency from day one? If you plan to white-label this for other brokers later, the tenant isolation work is worth doing now.

Answers to these shape which parts of Phase 1 get compressed versus expanded.
