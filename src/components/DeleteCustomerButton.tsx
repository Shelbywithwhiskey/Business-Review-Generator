"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Delete an account from the Customers list. Two clicks: "Delete" → "Yes, delete" (no browser dialog). */
export function DeleteCustomerButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      setConfirming(false);
      setError("Couldn't delete — try again.");
      return;
    }
    router.refresh();
  }

  if (!confirming)
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${name}`}
          className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs text-neutral-500">Delete {name} and all its data?</span>
      <div className="flex gap-1.5">
        <button onClick={remove} disabled={deleting} className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
          {deleting ? "Deleting…" : "Yes, delete"}
        </button>
        <button onClick={() => setConfirming(false)} disabled={deleting} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
