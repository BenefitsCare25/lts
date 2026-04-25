// =============================================================
// prisma/seed.ts — no-op stub for the bootstrap session.
//
// The full seed (one Agency, two Clients, three Insurers, three
// catalogue ProductTypes built from the CUBER AI placement slip)
// lands in Story S8 of docs/build_brief.md.
//
// Until then this file exists so:
//   - `pnpm prisma db seed` completes successfully
//   - `pnpm db:seed` resolves the same way
//   - dev-setup.sh has a stable hook to call once migrations exist
//
// Do not import @prisma/client here yet — until S6 ports the
// schema and runs the first migration, the generated client
// targets tables that don't exist.
// =============================================================

async function main(): Promise<void> {
  // biome-ignore lint/suspicious/noConsoleLog: intentional dev script output
  console.log(
    '[seed] no-op stub. The real seed is implemented in Story S8 ' +
      '(see docs/build_brief.md section 6, Epic 2).',
  );
}

main().catch((error: unknown) => {
  console.error('[seed] failed:', error);
  process.exitCode = 1;
});
