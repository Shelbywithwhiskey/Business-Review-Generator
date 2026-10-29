import Link from "next/link";
import { DbStatusBanner } from "@/components/DbStatusBanner";

export function Nav() {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <DbStatusBanner />
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-semibold">
          Zuper CBR Generator
        </Link>
        <Link
          href="/customers/new"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
        >
          + Add customer
        </Link>
      </div>
    </header>
  );
}
