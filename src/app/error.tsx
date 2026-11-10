"use client"; // Error boundaries must be Client Components

// Server errors reach the browser without their message in production, so this can't tell a
// database outage from a bug; it points at both and gives the digest to match in the Vercel logs.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="mb-2 text-lg font-semibold">This page couldn&apos;t load</h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Something went wrong on the server. If it keeps happening, the database may be offline — check the Supabase dashboard.
        {error.digest ? ` Error reference: ${error.digest}.` : ""}
      </p>
      <button
        onClick={() => retry()}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
      >
        Try again
      </button>
    </main>
  );
}
