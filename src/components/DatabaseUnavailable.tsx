import { DB_UNAVAILABLE_MESSAGE } from "@/lib/dbStatus";

export function DatabaseUnavailable() {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <h2 className="mb-2 font-semibold">Database unavailable</h2>
      <p className="text-sm">{DB_UNAVAILABLE_MESSAGE}</p>
    </div>
  );
}
