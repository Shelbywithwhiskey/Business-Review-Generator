import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runCatalogSync, CATALOG } from "@/lib/zuper/catalog";
import { getOrDiscoverConnection } from "@/lib/zuper/sync";

export const maxDuration = 300;

const schema = z.object({
  // Entered by hand for every sync and used only for this request — never stored.
  apiKey: z.string().trim().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  startIndex: z.number().int().min(0).optional(),
});

/** Pulls every catalog module (see lib/zuper/catalog.ts). Called repeatedly by the customer page
 * with the returned nextIndex until it is null, so each request stays inside the time limit. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const parsed = schema.safeParse(await req.json());
  // Deliberately not echoing parsed.error — it would include the submitted fields.
  if (!parsed.success) return NextResponse.json({ error: "A Zuper API key and sync period are required" }, { status: 400 });

  try {
    const credential = await getOrDiscoverConnection(customerId);
    const run = await prisma.syncRun.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
    if (!run) return NextResponse.json({ error: "Run the main sync first" }, { status: 400 });

    const { nextIndex, results } = await runCatalogSync(
      customerId,
      parsed.data.apiKey,
      credential.baseUrl,
      { start: new Date(parsed.data.periodStart), end: new Date(parsed.data.periodEnd) },
      run.id,
      { startIndex: parsed.data.startIndex ?? 0, deadline: Date.now() + 270_000 }
    );
    return NextResponse.json({ nextIndex, total: CATALOG.length, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Catalog sync failed" }, { status: 500 });
  }
}
