import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-wider text-slate-500">404</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Page not found</h1>
      <p className="text-base text-slate-600">
        That route doesn&apos;t exist (yet). Head back to the{" "}
        <Link href="/" className="font-medium text-slate-900 underline">
          home page
        </Link>
        .
      </p>
    </main>
  );
}
