import { NextRequest, NextResponse } from "next/server";
import { buildReportDeck } from "@/lib/reports/reportDeck";

// The brief is built from every call-out in the deck, so this builds the deck (without storing it).
export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deck = await buildReportDeck(id);
    if (!deck) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json({ brief: deck.brief });
  } catch (err) {
    console.error(`Account brief failed for report ${id}`, err);
    return NextResponse.json({ error: `Could not build the brief: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
