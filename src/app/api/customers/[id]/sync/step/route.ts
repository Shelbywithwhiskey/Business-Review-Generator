import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SyncFatalError, failSync, runSyncSteps, startSync } from "@/lib/zuper/sync";

export const maxDuration = 300;

const schema = z.object({
  // Entered by hand for every sync and used only for these requests — never stored.
  // Trimmed: a key pasted with a trailing space or newline is rejected by Zuper with a 401.
  apiKey: z.string().trim().min(1),
  /** Start: the period. Continue: the run and the cursor the previous response returned. */
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  syncRunId: z.string().optional(),
  cursor: z.object({ step: z.number().int().min(0), page: z.number().int().min(0) }).optional(),
  /** The page gave up after retries: close the run as failed. */
  abort: z.string().max(500).optional(),
});

/**
 * One slice of a sync (see lib/zuper/sync.ts). The customer page calls this in a loop — first with the
 * period to start a run, then with { syncRunId, cursor } until the returned cursor is null — and
 * retries a failed call from the same cursor, which is safe because every step is idempotent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  // Deliberately not echoing parsed.error — it would include the submitted fields.
  if (!parsed.success) return NextResponse.json({ error: "A Zuper API key and sync period are required" }, { status: 400 });
  const { apiKey, periodStart, periodEnd, syncRunId, cursor, abort } = parsed.data;

  if (abort && syncRunId) {
    await failSync(syncRunId, abort);
    return NextResponse.json({ ok: true });
  }

  let runId = syncRunId;
  try {
    if (!runId || !cursor) {
      if (!periodStart || !periodEnd) return NextResponse.json({ error: "A sync period is required" }, { status: 400 });
      const started = await startSync(customerId, { start: new Date(periodStart), end: new Date(periodEnd) });
      runId = started.syncRunId;
      return NextResponse.json(await runSyncSteps(customerId, apiKey, runId, started.cursor!));
    }
    return NextResponse.json(await runSyncSteps(customerId, apiKey, runId, cursor));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    if (err instanceof SyncFatalError) {
      if (runId) await failSync(runId, message);
      return NextResponse.json({ error: message, fatal: true }, { status: 422 });
    }
    console.error(`Sync step failed for customer ${customerId}`, err);
    // Retryable: the page calls again from the same cursor (runId lets a failed first call be retried too).
    return NextResponse.json({ error: message, syncRunId: runId }, { status: 500 });
  }
}
