import { NextRequest, NextResponse } from "next/server";
import { del, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { generateEbrPptx } from "@/lib/pptx/ebrExport";

// Large accounts (tens of thousands of synced records) need more than a minute to assemble the deck.
export const maxDuration = 300;

const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
/** How long the download link handed to the browser stays valid. */
const LINK_TTL_MS = 60 * 60 * 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true, website: true } } },
  });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const reportTitle =
    report.type === "QBR"
      ? "Quarterly Business Review"
      : report.type === "MBR"
        ? "Monthly Business Review"
        : "Half-Year Business Review";

  let buffer: Buffer;
  try {
    buffer = await generateEbrPptx({
      customerId: report.customer.id,
      customerName: report.customer.name,
      customerWebsite: report.customer.website,
      range: { start: report.periodStart, end: report.periodEnd },
      reportTitle,
    });
  } catch (err) {
    console.error(`EBR export failed for report ${id}`, err);
    return NextResponse.json({ error: `Could not build the deck: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  const filename = `${report.customer.name.trim().replace(/[^a-z0-9]+/gi, "_")}_EBR_${new Date(report.periodEnd).toISOString().slice(0, 10)}.pptx`;

  // Vercel caps a function response at 4.5 MB and the template alone is ~18 MB, so on Vercel the deck
  // goes to private Blob storage and the browser is redirected to a short-lived signed link.
  // Without a Blob store (local dev) the file is returned directly.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": PPTX_TYPE, "Content-Disposition": `attachment; filename="${filename}"` },
    });
  }

  try {
    // Keep only the latest export per report: decks hold customer business data.
    const prefix = `exports/${id}/`;
    const { blobs: previous } = await list({ prefix });
    if (previous.length) await del(previous.map((b) => b.url));

    const blob = await put(`${prefix}${filename}`, buffer, { access: "private", addRandomSuffix: true, contentType: PPTX_TYPE });
    const validUntil = Date.now() + LINK_TTL_MS;
    const token = await issueSignedToken({ pathname: blob.pathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: blob.pathname, access: "private", validUntil });
    return NextResponse.redirect(presignedUrl, 303);
  } catch (err) {
    console.error(`EBR export upload failed for report ${id}`, err);
    return NextResponse.json({ error: `The deck was built but could not be stored for download: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
