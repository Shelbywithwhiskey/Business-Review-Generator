import { prisma } from "@/lib/db";
import { DB_STORAGE_LIMIT_MB } from "@/lib/dbStatus";

/** How much of the free plan's database storage is used, so a full database is seen coming. */
export async function StorageMeter() {
  let usedMb: number;
  try {
    const [row] = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
    usedMb = Number(row.bytes) / 1024 / 1024;
  } catch (err) {
    console.error("Storage meter: size query failed", err);
    return null;
  }

  const pct = Math.min(100, (usedMb / DB_STORAGE_LIMIT_MB) * 100);
  const level = pct >= 90 ? "full" : pct >= 75 ? "warn" : "ok";
  const bar = level === "full" ? "bg-red-600" : level === "warn" ? "bg-amber-500" : "bg-emerald-600";

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Database storage</span>
        <span className="text-neutral-500">
          {usedMb.toFixed(0)} MB of {DB_STORAGE_LIMIT_MB} MB ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className={`h-full ${bar}`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      {level !== "ok" && (
        <p className={`mt-2 ${level === "full" ? "text-red-600" : "text-amber-600"}`}>
          {level === "full"
            ? "Almost full. The free plan stops accepting new data at the limit; delete customers you no longer review."
            : "Over three-quarters full. Consider deleting customers you no longer review."}
        </p>
      )}
    </div>
  );
}
