import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ZuperClient, discoverZuperConfig } from "@/lib/zuper/client";

// The Zuper API key is never persisted: it's entered by hand for each sync.
// This route only discovers/saves the (non-secret) data-center URLs and
// checks that a key the user typed in actually authenticates.

const schema = z.object({
  apiKey: z.string().min(1),
  // Optional manual override; normally the base URL is auto-discovered from
  // the customer's zuperAccountId (their Zuper company login name).
  baseUrl: z.string().url().optional(),
});

/** Tests the supplied key against Zuper and saves the discovered connection config (never the key). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "A Zuper API key is required" }, { status: 400 });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  let baseUrl = parsed.data.baseUrl;
  let workflowBaseUrl: string | null = null;
  if (!baseUrl) {
    try {
      const config = await discoverZuperConfig(customer.zuperAccountId);
      baseUrl = config.apiBaseUrl;
      workflowBaseUrl = config.workflowBaseUrl;
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not resolve a Zuper data center for account "${customer.zuperAccountId}": ${
            err instanceof Error ? err.message : String(err)
          }. Check the Zuper account ID on this customer matches their Zuper company login name.`,
        },
        { status: 400 }
      );
    }
  }

  const ok = await new ZuperClient(parsed.data.apiKey, baseUrl).testConnection();
  const connection = await prisma.apiCredential.upsert({
    where: { customerId },
    create: { customerId, baseUrl, workflowBaseUrl, lastVerifiedAt: ok ? new Date() : null },
    update: { baseUrl, workflowBaseUrl, ...(ok ? { lastVerifiedAt: new Date() } : {}) },
  });

  return NextResponse.json({ ok, baseUrl: connection.baseUrl, workflowBaseUrl: connection.workflowBaseUrl });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const connection = await prisma.apiCredential.findUnique({ where: { customerId } });
  if (!connection) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, baseUrl: connection.baseUrl, lastVerifiedAt: connection.lastVerifiedAt });
}
