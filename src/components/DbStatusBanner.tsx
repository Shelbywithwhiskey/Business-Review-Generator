"use client";

import { useEffect, useState } from "react";

/** Red bar across the top when /api/db-status reports the database is down. Client pages load
 * their data through API calls, so without this a dead database just looks like an empty page. */
export function DbStatusBanner() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/db-status", { cache: "no-store" })
      .then(async (res) => {
        if (res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "The database is unavailable.");
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!error) return null;
  return (
    <div role="alert" className="bg-red-600 px-6 py-2 text-center text-sm font-medium text-white">
      {error}
    </div>
  );
}
