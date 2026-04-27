# Insurance SaaS — Phase 1 Build Plan v2

This document supersedes `docs/build_brief.md` and is the canonical reference for Claude Code sessions on this repo. It folds in everything decided across the architecture and UI design conversations: metadata-driven catalogue, six registries, Screen 0 system config, the schema additions for stacked plans / flex benefits / per-entity rate overrides, and the Three Clients acceptance test.

If anything in this doc conflicts with `docs/build_brief.md` or `docs/architecture.md`, this doc wins. Update those two to match before starting any new story.

---

## 0. How Claude Code should use this document

**Read order at the start of every session:**

1. `CLAUDE.md` (repo root) — environment, conventions, commands
2. This document (`docs/PHASE_1_BUILD_PLAN_v2.md`) — the plan
3. The story you're working on (Section 8) — acceptance criteria
4. Any open ADR under `docs/ADRs/` — pending architectural decisions

**Working principle:** every story produces one PR. PRs land green CI before the next story starts. If a story turns out to be larger than estimated, split it and write an ADR explaining the split — don't merge a half-done story.

**When to pause and write an ADR:** if you discover a schema decision that this doc doesn't cover, or if a library choice in `CLAUDE.md` doesn't fit the story, stop and draft an ADR under `docs/ADRs/NNNN-short-title.md` before coding. ADRs use the standard template (Context / Decision / Consequences).

**Reference data to study before any catalogue work:** `reference/placement-slips/` contains Balance Medical, CUBER AI, and [REDACTED] placement slips. These are the source of truth for the seed data and the acceptance test. Read them before implementing parsers or seed scripts.

---

## 1. Architectural recap

### 1.1 The three-tier model

**Tier 1 — Relational core.** Tables that exist regardless of products or clients: `Tenant`, `User`, `Client`, `PolicyEntity`, `Policy`, `BenefitYear`, `Insurer`, `TPA`, `Pool`, `BenefitGroup`, `Employee`, `Dependent`, `Enrollment`, `EmployeeSchema`, `OperatorLibrary`, `ProductType`. These have fixed columns and evolve through Prisma migrations.

**Tier 2 — Product catalogue (data, not code).** `ProductType` rows hold JSON Schema definitions per product (GTL, GHS, GMM, GPA, GCI, GDI, SP, GP, Dental, FWM, GBT, WICI). Editable through the catalogue editor UI. Versioned. Adding a product type or adding a field to an existing one is a data change, not a deploy.

**Tier 3 — Product instances.** `Product`, `Plan`, `PremiumRate`, `BenefitSchedule` rows store the type-specific data as JSONB validated against the catalogue schema on every write.

### 1.2 The six metadata registries

Every dropdown in every screen reads from one of these. **None are hardcoded in UI code.**

| Registry | Storage | Updated by | Drives |
|---|---|---|---|
| Global Reference | seeded tables (countries, currencies, industries, SSIC codes) | system admin (rare) | Screens 1, 2 |
| Insurer Registry | `Insurer` table | catalogue admin | Screens 3, 5 |
| TPA Registry | `TPA` table | catalogue admin | Screen 5 |
| Pool Registry | `Pool` table with `member_insurers[]` | catalogue admin | Screens 3, 5 |
| Product Catalogue | `ProductType` table (JSON Schema per type) | catalogue admin | Screens 3, 5 |
| Operator Library | `OperatorLibrary` table (operators per data type) | system admin (one-time) | Screen 4 |
| Employee Schema | `EmployeeSchema` table (per tenant) | tenant admin | Screen 4, employee admin, parsers, census export |

### 1.3 Multi-tenancy boundary

Every tenant-scoped table has `tenant_id` enforced via Postgres row-level security policies. Application middleware sets `app.current_tenant_id` per request. A query without a tenant context returns zero rows by default. The catalogue, insurer registry, TPA registry, pool registry, and operator library are tenant-scoped — this means brokers cannot see each other's catalogue customisations.

---

## 2. Updated Prisma schema (canonical)

Place this in `prisma/schema.prisma`. Every additive field (vs the v1 starter schema) is annotated with the limitation it closes.

```prisma
// ===== Tenancy =====

model Tenant {
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique
  createdAt     DateTime @default(now())
  // relations
  users         User[]
  clients       Client[]
  employeeSchemas EmployeeSchema[]
  productTypes  ProductType[]
  insurers      Insurer[]
  tpas          TPA[]
  pools         Pool[]
}

model User {
  id          String   @id @default(cuid())
  tenantId    String
  email       String   @unique
  role        UserRole // BROKER_ADMIN | CATALOGUE_ADMIN | TENANT_ADMIN | CLIENT_HR | EMPLOYEE
  workosUserId String? @unique
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  @@index([tenantId])
}

enum UserRole {
  TENANT_ADMIN
  CATALOGUE_ADMIN
  BROKER_ADMIN
  CLIENT_HR
  EMPLOYEE
}

// ===== Global reference data (system-level, not tenant-scoped) =====

model Country {
  code  String @id  // ISO 3166 alpha-2: "SG", "MY", "US"
  name  String
  uenPattern String?  // regex for business registration validation; null = no pattern
}

model Currency {
  code String @id  // ISO 4217: "SGD", "USD"
  name String
  decimals Int  // 2 for SGD, 0 for JPY, etc.
}

model Industry {
  code String @id  // SSIC code: "62010", "47711"
  name String
  parentCode String?
}

// ===== Tenant-scoped registries (Screen 0) =====

model EmployeeSchema {
  id        String   @id @default(cuid())
  tenantId  String   @unique  // one schema per tenant; clients inherit
  version   Int      @default(1)
  fields    Json     // FieldDef[] — see EmployeeSchemaFieldDef type below
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
}

// FieldDef stored in EmployeeSchema.fields:
//   {
//     name: string,                    // "employee.work_pass_type"
//     label: string,                   // "Work Pass Type"
//     type: "string"|"integer"|"number"|"boolean"|"date"|"enum"|"fk_lookup",
//     enumValues?: string[],           // for type=enum
//     min?: number, max?: number,      // for type=integer/number
//     pattern?: string,                // for type=string with format
//     fkTable?: string,                // for type=fk_lookup
//     required: boolean,
//     selectableForPredicates: boolean,
//     pii: boolean,                    // PDPA marker — affects logging and export
//     tier: "BUILTIN"|"STANDARD"|"CUSTOM",
//     enabled: boolean                 // STANDARD fields can be toggled off
//   }

model OperatorLibrary {
  dataType String @id  // "string" | "integer" | "number" | "boolean" | "date" | "enum"
  operators Json  // [{ code: "in", label: "is one of", arity: "multi" }, ...]
}

model Insurer {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  code      String   // "TM_LIFE", "GE_LIFE", "ZURICH"
  productsSupported String[]  // ["GTL", "GHS", "GMM", ...]
  claimFeedProtocol String?    // "IHP", "TMLS", "DIRECT_API", null
  active    Boolean  @default(true)
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  pools     PoolMembership[]
  @@unique([tenantId, code])
}

model TPA {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  code      String   // "IHP", "MHC"
  supportedInsurerIds String[]
  feedFormat String   // "CSV_V1", "JSON_API", etc.
  active    Boolean  @default(true)
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, code])
}

// FIX for: pool/captive arrangements not modelled
model Pool {
  id        String   @id @default(cuid())
  tenantId  String
  name      String   // "Generali Pool — Captive"
  description String?
  members   PoolMembership[]
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
}

model PoolMembership {
  id        String   @id @default(cuid())
  poolId    String
  insurerId String
  shareBps  Int?     // basis points share, null = unspecified
  pool      Pool     @relation(fields: [poolId], references: [id])
  insurer   Insurer  @relation(fields: [insurerId], references: [id])
  @@unique([poolId, insurerId])
}

model ProductType {
  id        String   @id @default(cuid())
  tenantId  String
  code      String   // "GTL", "GHS", "GMM", ...
  name      String
  schema    Json     // JSON Schema for the product instance fields
  planSchema Json    // JSON Schema for plans of this type, includes stacks_on / selection_mode
  premiumStrategy String  // "per_individual_salary_multiple" | "per_individual_fixed_sum" | "per_group_cover_tier" | "per_headcount_flat" | "per_individual_earnings"
  parsingRules Json?  // for Excel parser — selector rules per insurer template
  displayTemplate Json? // for employee portal card rendering
  version   Int      @default(1)
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, code])
}

// ===== Client onboarding (Screens 1-6) =====

model Client {
  id            String   @id @default(cuid())
  tenantId      String
  legalName     String
  tradingName   String?
  uen           String   // ACRA UEN or foreign equivalent
  countryOfIncorporation String  // FK to Country.code
  address       String
  industry      String?  // SSIC code
  primaryContactName  String?
  primaryContactEmail String?
  status        ClientStatus @default(ACTIVE)
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  policies      Policy[]
  employees     Employee[]
  @@index([tenantId])
}

enum ClientStatus { ACTIVE | DRAFT | ARCHIVED }

model Policy {
  id              String   @id @default(cuid())
  clientId        String
  name            String
  client          Client   @relation(fields: [clientId], references: [id])
  benefitYears    BenefitYear[]
  entities        PolicyEntity[]
  benefitGroups   BenefitGroup[]
  versionId       Int      @default(1)  // FIX: optimistic locking
}

model BenefitYear {
  id          String   @id @default(cuid())
  policyId    String
  startDate   DateTime
  endDate     DateTime
  state       BenefitYearState  @default(DRAFT)
  publishedAt DateTime?
  publishedBy String?
  policy      Policy   @relation(fields: [policyId], references: [id])
  products    Product[]
  @@unique([policyId, startDate])
}

enum BenefitYearState { DRAFT | PUBLISHED | ARCHIVED }

// FIX for: per-entity rate overrides not supported
model PolicyEntity {
  id            String   @id @default(cuid())
  policyId      String
  legalName     String
  policyNumber  String   // insurer-issued, may differ per entity
  address       String?
  headcountEstimate Int?
  isMaster      Boolean  @default(false)
  rateOverrides Json?    // null = inherit from product/plan; otherwise per-product overrides
  policy        Policy   @relation(fields: [policyId], references: [id])
  @@unique([policyId, policyNumber])
}

// FIX for: predicate depth — JSONLogic supports arbitrary nesting; UI exposes raw mode
model BenefitGroup {
  id        String   @id @default(cuid())
  policyId  String
  name      String
  predicate Json     // JSONLogic expression; can be arbitrarily nested
  description String?
  policy    Policy   @relation(fields: [policyId], references: [id])
  @@index([policyId])
}

model Product {
  id              String   @id @default(cuid())
  benefitYearId   String
  productTypeId   String   // FK to ProductType
  insurerId       String
  poolId          String?
  tpaId           String?
  data            Json     // validated against ProductType.schema
  versionId       Int      @default(1)  // FIX: optimistic locking
  benefitYear     BenefitYear @relation(fields: [benefitYearId], references: [id])
  plans           Plan[]
  eligibility     ProductEligibility[]
  premiumRates    PremiumRate[]
  @@index([benefitYearId])
}

// FIX for: stacked rider plans (STM Plan C / D)
// FIX for: flex benefits picker (STM Flex S/M/MC/MC2)
model Plan {
  id            String   @id @default(cuid())
  productId     String
  code          String   // "P1", "P4", "PA", etc.
  name          String
  coverBasis    String   // "per_cover_tier" | "salary_multiple" | "fixed_amount" | "per_region"
  stacksOn      String?  // FIX: Plan ID this plan stacks on top of (null = base plan)
  selectionMode String   @default("broker_default")  // FIX: "broker_default" | "employee_flex"
  schedule      Json     // benefit schedule fields, validated against ProductType.planSchema
  effectiveFrom DateTime?  // FIX: effective-dated benefit schedules
  effectiveTo   DateTime?
  product       Product  @relation(fields: [productId], references: [id])
  riderOf       Plan?    @relation("PlanRider", fields: [stacksOn], references: [id])
  riders        Plan[]   @relation("PlanRider")
  @@unique([productId, code])
}

model ProductEligibility {
  id              String   @id @default(cuid())
  productId       String
  benefitGroupId  String
  defaultPlanId   String
  product         Product  @relation(fields: [productId], references: [id])
  @@unique([productId, benefitGroupId])
}

model PremiumRate {
  id        String   @id @default(cuid())
  productId String
  planId    String
  groupId   String?  // null = applies to all groups
  coverTier String?  // "EO" | "ES" | "EC" | "EF" — for per_cover_tier basis
  ratePerThousand Decimal?
  fixedAmount Decimal?
  product   Product  @relation(fields: [productId], references: [id])
}

// ===== Employees (Screen 7+, post-onboarding) =====

model Employee {
  id              String   @id @default(cuid())
  clientId        String
  data            Json     // validated against tenant's EmployeeSchema
  status          EmployeeStatus @default(ACTIVE)
  hireDate        DateTime
  terminationDate DateTime?
  client          Client   @relation(fields: [clientId], references: [id])
  dependents      Dependent[]
  enrollments     Enrollment[]
  @@index([clientId])
}

enum EmployeeStatus { ACTIVE | SUSPENDED | TERMINATED }

model Dependent {
  id          String   @id @default(cuid())
  employeeId  String
  data        Json
  relation    String   // "spouse" | "child" | "parent"
  employee    Employee @relation(fields: [employeeId], references: [id])
}

model Enrollment {
  id              String   @id @default(cuid())
  employeeId      String
  productId       String
  planId          String
  benefitGroupId  String
  coverTier       String?  // "EO" | "ES" | "EC" | "EF"
  effectiveFrom   DateTime
  effectiveTo     DateTime?
  employee        Employee @relation(fields: [employeeId], references: [id])
}

// ===== Audit + integrations =====

model AuditLog {
  id        String   @id @default(cuid())
  tenantId  String
  userId    String?
  action    String   // "client.created", "policy.published", etc.
  entityType String
  entityId  String
  before    Json?
  after     Json?
  ipAddress String?
  createdAt DateTime @default(now())
  @@index([tenantId, createdAt])
  @@index([entityType, entityId])
}

model PlacementSlipUpload {
  id          String   @id @default(cuid())
  clientId    String
  uploadedBy  String
  filename    String
  storageKey  String   // S3/Azure blob key
  insurerTemplate String?  // detected template; null if unknown
  parseStatus String   // "PENDING" | "PARSED" | "FAILED" | "REVIEWED" | "APPLIED"
  parseResult Json?
  issues      Json?    // list of resolved/unresolved issues
  createdAt   DateTime @default(now())
}
```

---

## 3. The six registries — detailed seed data

### 3.1 Global Reference (system-seeded once)

**Countries:** seed all ISO 3166 alpha-2 entries. Set `uenPattern` for SG only initially:

```
SG: ^[0-9]{8,10}[A-Z]$         (ACRA UEN)
MY: ^[0-9]{6,12}-[A-Z0-9]$     (SSM)
others: null
```

**Currencies:** SGD, USD, MYR, EUR, GBP, JPY, CNY, HKD, AUD with correct decimals.

**Industries:** import the SG SSIC 2020 list (~1100 entries) from a CSV.

### 3.2 Operator Library (system-seeded once)

```json
{
  "string": [
    { "code": "eq", "label": "equals", "arity": "single" },
    { "code": "neq", "label": "does not equal", "arity": "single" },
    { "code": "contains", "label": "contains", "arity": "single" },
    { "code": "startsWith", "label": "starts with", "arity": "single" },
    { "code": "endsWith", "label": "ends with", "arity": "single" },
    { "code": "in", "label": "is one of", "arity": "multi" },
    { "code": "notIn", "label": "is not one of", "arity": "multi" }
  ],
  "integer": [
    { "code": "eq", "label": "=", "arity": "single" },
    { "code": "neq", "label": "≠", "arity": "single" },
    { "code": "lt", "label": "<", "arity": "single" },
    { "code": "lte", "label": "≤", "arity": "single" },
    { "code": "gt", "label": ">", "arity": "single" },
    { "code": "gte", "label": "≥", "arity": "single" },
    { "code": "between", "label": "between", "arity": "range" },
    { "code": "in", "label": "is one of", "arity": "multi" },
    { "code": "notIn", "label": "is not one of", "arity": "multi" }
  ],
  "number": [ /* same as integer */ ],
  "boolean": [
    { "code": "eq", "label": "is", "arity": "single" }
  ],
  "date": [
    { "code": "eq", "label": "on", "arity": "single" },
    { "code": "before", "label": "before", "arity": "single" },
    { "code": "after", "label": "after", "arity": "single" },
    { "code": "between", "label": "between", "arity": "range" },
    { "code": "withinDays", "label": "within last N days", "arity": "single" }
  ],
  "enum": [
    { "code": "eq", "label": "is", "arity": "single" },
    { "code": "neq", "label": "is not", "arity": "single" },
    { "code": "in", "label": "is one of", "arity": "multi" },
    { "code": "notIn", "label": "is not one of", "arity": "multi" }
  ]
}
```

### 3.3 Initial Employee Schema (per-tenant default, copied on tenant creation)

**Built-in fields (5, always present, cannot be removed):**

```json
[
  { "name": "employee.full_name", "label": "Full Name", "type": "string", "tier": "BUILTIN", "required": true, "pii": true, "selectableForPredicates": false },
  { "name": "employee.date_of_birth", "label": "Date of Birth", "type": "date", "tier": "BUILTIN", "required": true, "pii": true, "selectableForPredicates": true },
  { "name": "employee.age_next_birthday", "label": "Age Next Birthday", "type": "integer", "min": 0, "max": 120, "tier": "BUILTIN", "required": false, "computed": true, "pii": false, "selectableForPredicates": true },
  { "name": "employee.hire_date", "label": "Hire Date", "type": "date", "tier": "BUILTIN", "required": true, "pii": false, "selectableForPredicates": true },
  { "name": "employee.employment_status", "label": "Employment Status", "type": "enum", "enumValues": ["ACTIVE", "SUSPENDED", "TERMINATED"], "tier": "BUILTIN", "required": true, "pii": false, "selectableForPredicates": true }
]
```

**Standard extension fields (5, toggleable on/off):**

```json
[
  { "name": "employee.nationality", "label": "Nationality", "type": "enum", "enumValues": ["SG", "PR", "MY", "IN", "PH", "CN", "FOREIGN"], "tier": "STANDARD", "enabled": true, "pii": true, "selectableForPredicates": true },
  { "name": "employee.work_pass_type", "label": "Work Pass Type", "type": "enum", "enumValues": ["CITIZEN", "PR", "EP", "S_PASS", "WORK_PERMIT", "DEPENDANT_PASS", "NONE"], "tier": "STANDARD", "enabled": true, "pii": true, "selectableForPredicates": true },
  { "name": "employee.employment_type", "label": "Employment Type", "type": "enum", "enumValues": ["PERMANENT", "CONTRACT", "INTERN", "BARGAINABLE"], "tier": "STANDARD", "enabled": true, "pii": false, "selectableForPredicates": true },
  { "name": "employee.last_drawn_salary", "label": "Last Drawn Monthly Salary", "type": "number", "min": 0, "max": 999999, "tier": "STANDARD", "enabled": true, "pii": true, "selectableForPredicates": true },
  { "name": "employee.role", "label": "Role Classification", "type": "enum", "enumValues": ["SENIOR_MGMT", "CORPORATE_STAFF", "JUNIOR"], "tier": "STANDARD", "enabled": false, "pii": false, "selectableForPredicates": true }
]
```

**Custom field examples (added per tenant as needed):**

For STM, the broker admin would add: `employee.hay_job_grade` (integer 1–25), `employee.is_fire_fighter` (boolean), `employee.flex_tier` (enum FLEX_S/M/MC/MC2), `employee.entity_id` (fk_lookup to PolicyEntity).

### 3.4 Initial Insurer Registry (per tenant — seed Acme Brokers tenant)

From the three placement slips, seed these 6:

| Code | Name | Products supported | Claim feed |
|---|---|---|---|
| TM_LIFE | Tokio Marine Life Insurance Singapore | GTL, GCI, GHS, GMM, GP, SP, Dental | IHP |
| GE_LIFE | Great Eastern Life Assurance | GTL, GHS, GMM, SP | TMLS |
| ZURICH | Zurich Insurance | GPA, GBT | DIRECT_API |
| ALLIED_WORLD | Allied World | WICI | null |
| ALLIANZ | Allianz | WICI | null |
| CHUBB | Chubb | GBT | null |

### 3.5 Initial Product Catalogue (per tenant — seed 12 product types)

Seed entries for: GTL, GCI, GDI, GPA, GHS, GMM, FWM, GP, SP, Dental, GBT, WICI.

For each, the `schema` JSON Schema captures the product-level fields (insurer, policy_number, eligibility, age_limits, member_cover, etc.). The `planSchema` captures plan-level fields including `stacksOn` and `selectionMode`. The `premiumStrategy` references one of the 5 strategies (see §4 below). The `parsingRules` are populated initially from the Tokio Marine and Great Eastern templates only; other insurer templates are added as they're encountered.

A condensed example for GHS `planSchema`:

```json
{
  "type": "object",
  "required": ["code", "name", "coverBasis", "schedule"],
  "properties": {
    "code": { "type": "string", "pattern": "^P[0-9]+$" },
    "name": { "type": "string" },
    "coverBasis": { "enum": ["per_cover_tier"] },
    "stacksOn": { "type": ["string", "null"] },
    "selectionMode": { "enum": ["broker_default", "employee_flex"], "default": "broker_default" },
    "schedule": {
      "type": "object",
      "properties": {
        "dailyRoomBoard": { "type": "number", "minimum": 0 },
        "icuLimit": { "type": "number" },
        "inpatientCap": { "type": "number" },
        "outpatientCap": { "type": "number" },
        "preHospitalisationDays": { "type": "integer", "default": 120 },
        "postHospitalisationDays": { "type": "integer", "default": 120 },
        "ambulanceFees": { "type": "number" },
        "deathFuneralBenefit": { "type": "number" },
        "extensionToCoverGST": { "type": "boolean" }
      }
    }
  }
}
```

---

## 4. Premium calculation strategies (referenced from ProductType.premiumStrategy)

Five strategies cover everything in the three placement slips. Strategies are code (they're math) — not catalogue data.

| Code | Description | Used by |
|---|---|---|
| `per_individual_salary_multiple` | sum_assured = salary × multiplier (bounded by min/max), premium = sum_assured / 1000 × rate_per_1000 | GTL (CUBER corporate, STM all), GDI |
| `per_individual_fixed_sum` | premium = sum_assured / 1000 × rate_per_1000 | GTL (CUBER senior), GCI |
| `per_group_cover_tier` | Per group, premium = headcount_per_tier × tier_rate, summed across EO/ES/EC/EF | GHS, GMM, Dental, SP, GP |
| `per_headcount_flat` | premium = headcount × flat_rate | GP (when uniform) |
| `per_individual_earnings` | premium = annual_earnings × rate (with earning band tiers) | WICI |

Each strategy is a TypeScript module under `src/server/premium-strategies/`. New strategies need a code change (rare). All strategies must implement the `PremiumStrategy` interface:

```typescript
interface PremiumStrategy {
  calculate(input: CalcInput): CalcOutput;
  validate(plan: Plan, rates: PremiumRate[]): ValidationResult;
  estimateForUI(plan: Plan, rates: PremiumRate[], headcountEstimates: Record<string, number>): MoneyAmount;
}
```

---

## 5. Screen 0 — System config (4 sub-screens)

Screen 0 runs once per tenant during onboarding. After this, Screens 1–6 work cleanly for any client added.

### 5.1 Sub-screen 0a — Employee Schema editor

**Inputs:**
- Field name (text, must start with `employee.`)
- Label (text)
- Type (dropdown from Operator Library data types)
- Allowed values (multi-input — dynamic based on type)
- Required (boolean)
- Selectable for predicates (boolean)
- PII flag (boolean)

**Tabs:** Built-in (read-only), Standard extensions (toggleable), Custom (add/edit/remove).

**Limitations addressed:** custom employee attributes per tenant.

### 5.2 Sub-screen 0b — Insurer Registry CRUD

**Inputs per insurer:** name (text), code (text, unique), products supported (multi-select from 12 product types), claim feed protocol (dropdown), pool memberships (repeating row table linking to Pool Registry).

### 5.3 Sub-screen 0c — TPA Registry CRUD

**Inputs:** name, code, supported insurers (multi-select), feed format (dropdown), active (boolean).

### 5.4 Sub-screen 0d — Pool Registry CRUD

**Inputs:** pool name, description, member insurers (repeating row with insurer dropdown + share basis points).

**Limitations addressed:** pool/captive arrangements (STM's "Generali Pool — Captive").

### 5.5 Sub-screen 0e — Product Catalogue editor

**Inputs:** product type code, name, schema JSON (rendered as visual schema editor), plan schema, premium strategy (dropdown from strategy library), parsing rules (per insurer template), display template.

**This is the most powerful screen.** Edits here propagate to every client's product configuration on next benefit year. Versioned. Publish gate.

---

## 6. Screens 1–6 — Per-client onboarding

For each screen below: purpose, inputs (with their source registry), the specific dropdowns and where their values come from, and the limitations addressed.

### 6.1 Screen 1 — Client info

| Field | Type | Source |
|---|---|---|
| Legal entity name | text | free text |
| Trading name | text | free text |
| UEN | text + validator | Country.uenPattern (Global Reference) |
| Country of incorporation | dropdown | Global Reference: Countries |
| Address | text | free text |
| Industry | dropdown | Global Reference: Industries (SSIC) |
| Primary contact name | text | free text |
| Contact email | text + email validator | free text |

### 6.2 Screen 2 — Policy & entities

| Field | Type | Source |
|---|---|---|
| Policy name | text | free text |
| Period start/end | date | calendar |
| Currency | dropdown | Global Reference: Currencies |
| Master policyholder | dropdown | Client.legalName + linked Clients |
| Sub-entities | repeating row | inline editing |
| Per-entity rate overrides | drill-down | Product Catalogue per-product schema |

**Limitations addressed:** per-entity rate overrides via `PolicyEntity.rateOverrides` JSONB.

### 6.3 Screen 3 — Product selection

| Field | Type | Source |
|---|---|---|
| Product type | repeating row table | Product Catalogue |
| Insurer per product | dropdown | Insurer Registry filtered by product type support |
| Pool per product | dropdown (optional) | Pool Registry |
| Policy number per entity | repeating | free text |

### 6.4 Screen 4 — Benefit groups (predicate builder)

| Field | Type | Source |
|---|---|---|
| Group name | text | free text |
| Predicate field | dropdown | Employee Schema (only fields where `selectableForPredicates=true`) |
| Predicate operator | dropdown | Operator Library (filtered by selected field's type) |
| Predicate value | dynamic | depends on field's type — see 6.4.1 |
| AND/OR connector | dropdown | static: ["AND", "OR"] |
| Live preview | read-only | computed by eligibility engine |

#### 6.4.1 Value field rendering by type

| Field type | Value input |
|---|---|
| `string` | text input |
| `integer` / `number` | number input with `min`/`max` from schema |
| `enum` | multi-select checkboxes from `enumValues` |
| `boolean` | true/false toggle |
| `date` | date picker |
| `fk_lookup` | dropdown populated from referenced table |

**Limitations addressed:** dynamic field discovery (no hardcoded fields), dynamic operator selection (no hardcoded operator list per field), nested predicate groups via JSONLogic recursion.

### 6.5 Screen 5 — Per-product configuration

Sub-tabs per product: Details · Plans · Eligibility · Premium.

#### 5a Details
Fields rendered dynamically from the `ProductType.schema` for the selected product. Common fields: insurer (dropdown from Insurer Registry filtered to support this product), TPA (dropdown from TPA Registry filtered to support the insurer), eligibility text, age limits, member cover (multi-select).

#### 5b Plans
Repeating row table validated against `ProductType.planSchema`. Each row has: code, name, cover basis (dropdown from `coverBasis` enum in plan schema), `stacksOn` (dropdown of base plans, optional), `selectionMode` (dropdown), benefit schedule fields (dynamic per ProductType).

**Limitations addressed:** stacked rider plans (STM Plan C/D), flex benefits picker (STM Flex tiers), effective-dated schedules.

#### 5c Eligibility
Matrix: rows are benefit groups (from Screen 4), columns are plans. Per cell: dropdown to pick default plan ID (or "ineligible").

#### 5d Premium
Strategy is auto-selected from `ProductType.premiumStrategy`. Inputs vary per strategy. Live computed preview from headcount estimates.

### 6.6 Screen 6 — Review & publish

Read-only summary cards per section. Validation engine runs and surfaces:
- **Blockers** (must resolve): missing required fields, schema mismatches, invalid stacks_on references.
- **Warnings** (acknowledge to publish): unusual premium variance vs prior year, mid-year period changes.

Publish action triggers: write `BenefitYear.state=PUBLISHED`, lock `versionId`, write AuditLog row, kick off insurer census export job, emit email notification.

**Limitations addressed:** optimistic locking via `versionId` to prevent concurrent overwrites.

---

## 7. Security & compliance baked in

Per `sg-enterprise-security` skill checklist — these are P0 requirements, not nice-to-haves:

| Req ID | Requirement | Implementation |
|---|---|---|
| SEC-001 | MFA for all users | WorkOS handles SSO + TOTP |
| SEC-002 | Encrypt PII at rest | Postgres pgcrypto for `Employee.data` and `Dependent.data` columns; KMS-managed keys |
| SEC-003 | Consent before collection | Client onboarding flow captures broker-attestation; employee portal captures employee consent |
| SEC-004 | Session timeout 15min | WorkOS session config |
| SEC-005 | Audit logging | `AuditLog` table; 90-day retention + cold archive |
| SEC-006 | Breach notification | Runbook in `docs/runbooks/breach-notification.md` |
| SEC-007 | Data export API | `/api/employees/:id/export` returns full employee record as JSON |
| SEC-008 | Data deletion | Soft-delete on `Employee.terminationDate`; hard-delete after 7-year retention via scheduled job |
| SEC-009 | Tenant isolation | Postgres RLS policies on every tenant-scoped table |
| SEC-010 | PII access logging | `AuditLog.action` includes `employee.viewed`, `employee.exported` |

PII flagging via `EmployeeSchema.fields[].pii: true` controls:
- field is encrypted at rest
- field is excluded from default API responses (must be explicitly requested)
- field access creates audit log row
- field is masked in non-production environments

---

## 8. Story breakdown — 35 stories in 8 phases

Each story produces one PR. Acceptance criteria are gherkin-style. Stories that take more than ~6 hours of Claude Code time should be split.

### Phase 1A — Foundation (S1–S5)

**S1: Repo + Bicep + CI/CD.** Set up monorepo (Next.js + Prisma + tRPC), Azure Bicep templates for AKS/Container Apps, GitHub Actions pipeline. AC: `git push main` triggers green CI; `./scripts/deploy-staging.sh` deploys to staging.

**S2: Auth via WorkOS.** Integrate WorkOS for SSO + MFA. AC: a user with role TENANT_ADMIN can log in to /admin; SSO works for Google + Microsoft; MFA prompt fires on first login.

**S3: Multi-tenancy middleware + RLS.** Postgres RLS policies on every tenant-scoped table; Express/Next.js middleware sets `app.current_tenant_id`. AC: a query without tenant context returns 0 rows for tenant-scoped tables; integration test confirms cross-tenant isolation.

**S4: Database baseline + Prisma schema.** Apply the schema in §2 of this doc. AC: `npx prisma migrate deploy` applies clean; seed script creates one demo tenant.

**S5: Background job queue (BullMQ + Redis).** AC: a sample job (`hello-world`) is dispatched and processed; Redis health check at /api/health/redis.

### Phase 1B — Registries / Screen 0 (S6–S12)

**S6: Global Reference seeding.** Seed Country, Currency, Industry tables. AC: `Country.findMany()` returns 249 entries; SG has uenPattern set.

**S7: Operator Library seeding.** Seed `OperatorLibrary` per §3.2. AC: 6 data type rows present.

**S8: Insurer Registry CRUD UI.** Screen 0b with create/edit/delete. AC: catalogue admin can add Tokio Marine Life with productsSupported = [GTL, GCI, GHS, GMM, GP, SP, Dental] and claimFeedProtocol = IHP.

**S9: TPA Registry CRUD UI.** Screen 0c. AC: catalogue admin can add IHP supporting Tokio Marine Life.

**S10: Pool Registry CRUD UI.** Screen 0d with member insurer associations. AC: catalogue admin can add "Generali Pool — Captive" with Great Eastern as member.

**S11: Employee Schema editor.** Screen 0a with built-in / standard / custom tiers. AC: the 5 built-in fields cannot be removed; standard fields can be toggled on/off; custom fields can be added with name validation `^employee\.[a-z_]+$`; saving triggers schema migration job.

**S12: Product Catalogue editor.** Screen 0e. AC: catalogue admin can edit GHS productType: add a `maternity_rider` field to schema, save, publish v2.5; a downstream form renders the new field.

### Phase 1C — Client onboarding setup (S13–S17)

**S13: Client CRUD (Screen 1).** AC: broker admin adds Balance Medical with country=SG, UEN validator passes, saves.

**S14: Policy + entities (Screen 2).** AC: STM client has 3 PolicyEntities created, each with own policy number; rateOverrides JSONB column accepts null (default) and a sample override JSON.

**S15: Product selection (Screen 3).** AC: dropdown for Insurer is filtered by `productsSupported` matching the row's product type; CUBER sample saves with 10 products spanning Tokio Marine + Zurich + Allied World.

**S16: Catalogue seed scripts.** Seed all 12 ProductTypes per §3.5 with schemas, planSchemas, premiumStrategy refs, and Tokio Marine + Great Eastern parsing rules. AC: `npm run seed:catalogue` populates 12 rows; spot-check GHS planSchema includes `stacksOn` and `selectionMode`.

**S17: Benefit year + draft state.** AC: creating a Policy auto-creates the first BenefitYear in DRAFT state; only admin can transition to PUBLISHED.

### Phase 1D — Predicate builder / Screen 4 (S18–S20)

**S18: Predicate builder reading Employee Schema dynamically.** AC: opening Screen 4 for a tenant whose Employee Schema has `hay_job_grade` (custom) shows it in the field dropdown; selecting it populates operator dropdown with integer operators; value input is a number field bounded by schema min/max.

**S19: Live employee match preview.** AC: typing a predicate and waiting <500ms shows a matching employee count; the preview re-evaluates on schema field changes.

**S20: Overlap detection on save.** AC: saving two benefit groups whose predicates intersect surfaces a warning; the user can acknowledge and save anyway; intersection check uses JSONLogic-aware logic.

### Phase 1E — Per-product config / Screen 5 (S21–S25)

**S21: Product details sub-tab (5a).** Fields rendered from `ProductType.schema`. AC: GHS shows different fields than GTL; required fields enforce.

**S22: Plans sub-tab (5b) with stacks_on and selectionMode.** AC: STM GTL has 4 plans; Plan C has stacksOn=Plan B set; the eligibility engine applies both Plan B and Plan C cover to a matching employee in dry-run.

**S23: Eligibility matrix sub-tab (5c).** AC: matrix renders N benefit groups × M plans dropdowns; saving creates ProductEligibility rows; missing assignments flagged on Screen 6 review.

**S24: Premium calculation sub-tab (5d) with strategy library.** AC: GHS uses `per_group_cover_tier`; CUBER GHS computes 1×$1260 (Senior EF) + 4×$172 (Corp EO) = $1,948 within ±$1.

**S25: Effective-dated benefit schedules.** AC: a Plan can have `effectiveFrom` mid-year; eligibility engine and premium calc respect the boundary.

### Phase 1F — Review + publish / Screen 6 (S26–S28)

**S26: Review summary view.** AC: the Three Clients render correctly — Balance shows 4 product cards, CUBER 10, STM 7; each card has Edit deep-link.

**S27: Validation engine.** AC: STM with stacked plans missing `stacksOn` raises a Blocker; mid-year period change raises a Warning; clean Balance setup raises 0 issues.

**S28: Draft → publish workflow with optimistic locking.** AC: two concurrent edits to the same Policy raise a 409 Conflict on the second save; UI prompts to refresh and re-apply; publishing creates an immutable BenefitYear snapshot.

### Phase 1G — Excel ingestion (S29–S32)

**S29: Upload + parser registry.** Upload a placement slip XLS to `/imports`; classify by insurer template; queue parse job. AC: balance_medical.xls is classified as Tokio Marine template.

**S30: Tokio Marine template parser.** Parse Balance + CUBER. AC: Balance parse produces 4 products with correct premiums (~$4,143 total); CUBER parse produces 10 products (~$8,275 total).

**S31: Great Eastern template parser.** Parse STM. AC: STM parse produces 7 products, 6 benefit groups (4 with compound predicates), 3 PolicyEntities with own policy numbers.

**S32: Parser review screen with issue resolution.** AC: STM parse surfaces "Plan C/D needs stacksOn — choose base plan" as a resolvable issue; user picks Plan B for Plan C; saves; passes Screen 6 validation.

### Phase 1H — Employees + claims (S33–S35)

**S33: Employee admin (CRUD against tenant Employee Schema).** AC: adding a new STM employee with hay_job_grade=8, work_pass_type=WORK_PERMIT auto-matches them to "Foreign Workers WP/SP HJG 08-10" group.

**S34: CSV import of employees.** AC: CSV columns map to Employee Schema fields by header; rows that fail validation against schema are surfaced for manual fix; successful rows create Employee records.

**S35: TPA claims feed (IHP).** AC: a sample IHP claim feed CSV is ingested; Enrollment lookups match claims to employees + plans; unmatched claims are flagged.

---

## 9. The Three Clients acceptance test

This is the canonical end-to-end test. A successful Phase 1 means:

```gherkin
Scenario: Balance Medical published cleanly
  Given the catalogue is seeded with all 12 ProductTypes
  And the tenant has Tokio Marine Life, Zurich, Allied World in Insurer Registry
  When the broker uploads balance_medical.xls
  And reviews the parser output
  Then 4 products are detected (GTL, GHS, GPA, WICI)
  And the validation engine reports 0 blockers and 0 warnings
  And clicking Publish transitions BenefitYear to PUBLISHED
  And the Employee portal shows 3 enrolled employees seeing their GHS Plan 1 EO cover

Scenario: CUBER AI published with one warning
  Given catalogue + insurers are seeded
  When the broker uploads CUBER_AI_2025.xlsx
  Then 10 products are detected
  And 1 warning is raised about GBT cover basis (Plan/Region vs cover tier)
  And acknowledging the warning allows publish
  And the Employee portal shows 5 enrolled employees on the correct plans

Scenario: [REDACTED] published with predicate builder used
  Given catalogue + insurers + Pool Registry seeded
  And tenant Employee Schema includes hay_job_grade, is_fire_fighter, flex_tier
  When the broker uploads [REDACTED]_2026.xls
  Then 7 products are detected
  And 6 benefit groups are detected (4 using compound predicates)
  And Plan C / Plan D rider relationships are detected and stacksOn is set
  And 3 PolicyEntities are detected with their own policy numbers
  And the validation engine raises 0 blockers
  And the Employee portal shows a sample Foreign Worker on GHS Plan 5 + GTL Plan B
```

If all three scenarios pass, Phase 1 is done.

---

## 10. Claude Code session workflow

**Per session:**

1. Pick the next unstarted story from §8.
2. Read `CLAUDE.md`, this doc's relevant section, the story's acceptance criteria.
3. Read the most recent ADRs under `docs/ADRs/`.
4. Branch: `feature/SXX-short-name`.
5. Implement.
6. Write tests. Aim for: unit tests on pure logic (predicate eval, premium calc), integration tests on tRPC endpoints, e2e Playwright tests on Screen 6 flows.
7. Run the full test suite locally.
8. Open PR with the story ID in the title and a checklist of the acceptance criteria.
9. Update `docs/PROGRESS.md` ticking off the story.
10. Stop. Don't start the next story in the same session.

**ADR template** (`docs/ADRs/NNNN-title.md`):

```markdown
# ADR NNNN: <Decision title>

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by ADR-MMMM

## Context
<What problem are we solving? What constraints?>

## Decision
<What we're doing and why.>

## Consequences
<Trade-offs, what becomes easier, what becomes harder, what we'd revisit.>

## Alternatives considered
<Other options and why we rejected them.>
```

**When to write an ADR vs just code:**
- Library/framework choice not in CLAUDE.md? **ADR.**
- Schema decision not in this doc? **ADR.**
- New premium strategy needed? **ADR + code.**
- Renaming a column? Just code.
- Bug fix? Just code.

---

## 11. Out of Phase 1 (deferred to Phase 2 explicitly)

These will not be built in Phase 1. Document them as backlog items and don't let them slip in:

- Bulk amendments across clients (only valuable at 20+ clients)
- Real-time collaboration / operational transforms (only valuable at 10+ broker headcount)
- Insurer template parser library beyond Tokio Marine + Great Eastern (add per insurer as encountered)
- Employee mobile app (web-responsive is sufficient)
- Renewal automation suggestions (too speculative)
- Insurer direct-API integrations beyond IHP (add per insurer)
- Analytics dashboard (basic reporting only in Phase 1)
- Foreign incorporation support beyond SG/MY/UK (extend as needed)

---

## 12. Files to update in the existing repo

When applying this plan to your existing Claude Code repo:

1. **Create:** `docs/PHASE_1_BUILD_PLAN_v2.md` (this file)
2. **Update:** `CLAUDE.md` — add a "PHASE 1 PLAN" section pointing to this doc as the canonical plan; mark `docs/build_brief.md` as superseded.
3. **Replace:** `prisma/schema.prisma` with the schema in §2.
4. **Create:** `prisma/seed.ts` implementing seeds for §3 (Global Reference, Operator Library, default Employee Schema, Insurer Registry, ProductType catalogue).
5. **Create:** `src/server/premium-strategies/` directory with one TS file per strategy in §4.
6. **Create:** `docs/PROGRESS.md` listing all 35 stories from §8 with checkboxes.
7. **Create:** `docs/ADRs/0001-metadata-driven-architecture.md` capturing the v2 architectural shift.
8. **Create:** `docs/ADRs/0002-stacked-plans-and-flex-mode.md` capturing the schema additions for STM blockers.
9. **Update:** `reference/README.md` — add a section pointing at this plan as required reading.
10. **Create:** `tests/three-clients-e2e/` — Playwright suite implementing §9 scenarios.

---

## 13. Definition of done for Phase 1

- All 35 stories shipped, each behind a green-CI PR.
- Three Clients scenarios in §9 all pass.
- SEC-001 through SEC-010 in §7 are implemented and have integration tests.
- A new client (a hypothetical fourth) can be onboarded end-to-end in under 30 minutes for a CUBER-complexity case, using only the UI (no developer involvement).
- A catalogue admin can add a new ProductType and have it appear in Screen 3 within the same session, with no deploy.
- Cross-tenant isolation has a passing test that attempts to read another tenant's data through the API and confirms 0 results.

When all six are true, Phase 1 ships and Phase 2 planning starts.
