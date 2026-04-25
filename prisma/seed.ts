/**
 * Development seed.
 *
 * Creates a deterministic dataset that the admin UI can land on:
 *   - 1 Agency           "Demo Brokers"
 *   - 1 User             "Demo Operator"
 *   - 2 Clients          "CUBER AI", "Balance Medical"
 *   - 3 Insurers         "Tokio Marine Life", "Zurich", "Great Eastern"
 *   - 3 ProductTypes     GHS, GTL, GPA — each with one published v1
 *
 * This script is **for local dev bootstrap only**. Production catalogue rows
 * are created through the catalogue admin UI (post-S10), which goes through
 * the same validation paths as user input. Do not extend this script with
 * customer data.
 */
import { type Prisma, PrismaClient } from "@prisma/client";
import { seedProductTypes } from "../packages/catalogue-schemas/src";

const prisma = new PrismaClient();

const DEMO_AGENCY = {
  workosOrganizationId: "org_demo_brokers",
  name: "Demo Brokers",
  slug: "demo-brokers",
};

const DEMO_USER = {
  workosUserId: "user_demo_operator",
  email: "operator@demo-brokers.test",
  displayName: "Demo Operator",
  role: "agency_admin" as const,
};

const CLIENTS = [
  {
    name: "CUBER AI",
    uen: "202012345A",
    businessType: "AI / software",
    address: "1 North Bridge Road, Singapore 179094",
    contactEmail: "hr@cuber.test",
  },
  {
    name: "Balance Medical",
    uen: "201998765B",
    businessType: "Healthcare clinic group",
    address: "10 Sinaran Drive, Singapore 307506",
    contactEmail: "ops@balancemed.test",
  },
] as const;

const INSURERS = [
  { name: "Tokio Marine Life Insurance Singapore", shortName: "TMLS", tpaName: "IHP" },
  { name: "Zurich Insurance Company", shortName: "Zurich", tpaName: null },
  { name: "Great Eastern Life", shortName: "GE", tpaName: null },
] as const;

async function main() {
  console.log("→ Seeding development dataset");

  const agency = await prisma.agency.upsert({
    where: { workosOrganizationId: DEMO_AGENCY.workosOrganizationId },
    create: DEMO_AGENCY,
    update: { name: DEMO_AGENCY.name, slug: DEMO_AGENCY.slug },
  });
  console.log(`  · agency  ${agency.name} (${agency.id})`);

  const user = await prisma.user.upsert({
    where: { workosUserId: DEMO_USER.workosUserId },
    create: { ...DEMO_USER, agencyId: agency.id },
    update: { email: DEMO_USER.email, displayName: DEMO_USER.displayName },
  });
  console.log(`  · user    ${user.displayName} (${user.email})`);

  for (const client of CLIENTS) {
    const row = await prisma.client.upsert({
      where: { agencyId_name: { agencyId: agency.id, name: client.name } },
      create: { ...client, agencyId: agency.id },
      update: client,
    });
    console.log(`  · client  ${row.name}`);
  }

  for (const insurer of INSURERS) {
    const row = await prisma.insurer.upsert({
      where: { agencyId_name: { agencyId: agency.id, name: insurer.name } },
      create: { ...insurer, agencyId: agency.id },
      update: insurer,
    });
    console.log(`  · insurer ${row.name}`);
  }

  for (const seed of seedProductTypes) {
    const productType = await prisma.productType.upsert({
      where: { agencyId_code: { agencyId: agency.id, code: seed.code } },
      create: {
        agencyId: agency.id,
        code: seed.code,
        name: seed.name,
        category: seed.category,
        description: seed.description,
      },
      update: { name: seed.name, category: seed.category, description: seed.description },
    });

    await prisma.productTypeVersion.upsert({
      where: { productTypeId_version: { productTypeId: productType.id, version: seed.version } },
      create: {
        productTypeId: productType.id,
        agencyId: agency.id,
        version: seed.version,
        effectiveFrom: new Date(seed.effectiveFrom),
        schemaProduct: seed.schemaProduct as Prisma.InputJsonValue,
        schemaPlan: seed.schemaPlan as Prisma.InputJsonValue,
        schemaSchedule: seed.schemaSchedule as Prisma.InputJsonValue,
        schemaRate: seed.schemaRate as Prisma.InputJsonValue,
        ingestionTemplate: seed.ingestionTemplate as unknown as Prisma.InputJsonValue,
        displayTemplate: seed.displayTemplate as unknown as Prisma.InputJsonValue,
        calcStrategy: seed.calcStrategy,
        status: "published",
        publishedAt: new Date(),
        publishedByUserId: user.id,
      },
      update: {
        // Versions are immutable in production; in dev we re-upsert during
        // iteration so the schema stays in sync with the seed source.
        schemaProduct: seed.schemaProduct as Prisma.InputJsonValue,
        schemaPlan: seed.schemaPlan as Prisma.InputJsonValue,
        schemaSchedule: seed.schemaSchedule as Prisma.InputJsonValue,
        schemaRate: seed.schemaRate as Prisma.InputJsonValue,
        ingestionTemplate: seed.ingestionTemplate as unknown as Prisma.InputJsonValue,
        displayTemplate: seed.displayTemplate as unknown as Prisma.InputJsonValue,
        calcStrategy: seed.calcStrategy,
      },
    });
    console.log(`  · catalogue ${seed.code} v${seed.version} (${seed.name})`);
  }

  console.log("✓ seed complete");
}

main()
  .catch((error) => {
    console.error("✗ seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
