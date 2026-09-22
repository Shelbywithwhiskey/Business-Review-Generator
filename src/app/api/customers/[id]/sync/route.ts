import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runSync } from "@/lib/zuper/sync";
import type { ModuleKey } from "@/lib/zuper/modules";

export const maxDuration = 300; // Vercel Fluid Compute allows longer durations; sync can take a while for large accounts

const schema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  modules: z
    .array(z.enum(["jobs", "invoices", "quotes", "teams", "payments", "products", "expenses", "timesheets", "endCustomers"]))
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await runSync(
      customerId,
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
