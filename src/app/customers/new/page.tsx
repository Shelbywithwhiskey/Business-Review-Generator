"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";

export default function NewCustomerPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [zuperAccountId, setZuperAccountId] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, zuperAccountId, website: website || undefined, notes: notes || undefined }),
    });
    setLoading(false);
    if (!res.ok) {
      setError("Failed to create customer");
      return;
    }
    const { customer } = await res.json();
    router.push(`/customers/${customer.id}`);
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-xl px-6 py-8">
        <h1 className="mb-6 text-lg font-semibold">Add customer</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Customer name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Acme Field Services"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Zuper account ID</label>
            <input
              required
              value={zuperAccountId}
              onChange={(e) => setZuperAccountId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="acme-fs"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Company website (optional)</label>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="acmefieldservices.com"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Used to give the AI engine business context (industry, services) when generating recommendations.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">About the company (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {loading ? "Creating…" : "Create customer"}
          </button>
        </form>
      </main>
    </div>
  );
}
