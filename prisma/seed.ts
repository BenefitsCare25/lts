// =============================================================
// prisma/seed.ts — no-op stub for the bootstrap session.
//
// The full seed (Global Reference + Operator Library + default
// EmployeeSchema + one demo Tenant + the 12 ProductType catalogue
// rows) lands across Stories S6, S7, S11, S16 of
// docs/PHASE_1_BUILD_PLAN_v2.md.
//
// Until then this file exists so:
//   - `pnpm prisma db seed` completes successfully
//   - `pnpm db:seed` resolves the same way
//   - dev-setup.sh has a stable hook to call once migrations exist
//
// Do not import @prisma/client to write rows here yet — there
// are no migrations applied, so the generated client targets
// tables that don't exist in the database.
// =============================================================

async function main(): Promise<void> {
  // biome-ignore lint/suspicious/noConsoleLog: intentional dev script output
  console.log(
    '[seed] no-op stub. Real seeds land in S6 (Global Reference), ' +
      'S7 (Operator Library), S11 (default Employee Schema), ' +
      'S16 (Product Catalogue). See docs/PHASE_1_BUILD_PLAN_v2.md §8.',
  );
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
