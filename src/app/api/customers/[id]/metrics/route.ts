import { NextRequest, NextResponse } from "next/server";
import { computeComparison, computeHealthScore, evaluateRules } from "@/lib/analytics";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const { searchParams } = new URL(req.url);
  const periodStart = searchParams.get("periodStart");
  const periodEnd = searchParams.get("periodEnd");

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "periodStart and periodEnd are required" }, { status: 400 });
  }

  const comparison = await computeComparison(customerId, {
    start: new Date(periodStart),
    end: new Date(periodEnd),
  });
  const health = computeHealthScore(comparison.current);
  const rules = evaluateRules(comparison.current, comparison);

  return NextResponse.json({ ...comparison, health, rules });
}
