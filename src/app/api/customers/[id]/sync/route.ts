import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runSync } from "@/lib/zuper/sync";
import type { ModuleKey } from "@/lib/zuper/modules";

export const maxDuration = 300; // Vercel Fluid Compute allows longer durations; sync can take a while for large accounts

const schema = z.object({
  // Entered by hand for every sync and used only for this request — never stored.
  apiKey: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  modules: z
    .array(
      z.enum([
        "jobs",
        "invoices",
        "quotes",
        "teams",
        "payments",
        "products",
        "expenses",
        "timesheets",
        "endCustomers",
        "organizations",
        "properties",
        "projects",
        "workflows",
        "executions",
      ])
    )
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  // Deliberately not echoing parsed.error — it would include the submitted fields.
  if (!parsed.success) return NextResponse.json({ error: "A Zuper API key and sync period are required" }, { status: 400 });

  try {
    const result = await runSync(
      customerId,
      parsed.data.apiKey,
      { start: new Date(parsed.data.periodStart), end: new Date(parsed.data.periodEnd) },
      parsed.data.modules as ModuleKey[] | undefined
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
