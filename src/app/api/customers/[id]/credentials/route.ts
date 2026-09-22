import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ZuperClient, discoverZuperConfig } from "@/lib/zuper/client";

const schema = z.object({
  apiKey: z.string().min(1),
  // Optional manual override; normally the base URL is auto-discovered from
  // the customer's zuperAccountId (their Zuper company login name).
  baseUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

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

  const encryptedApiKey = encryptSecret(parsed.data.apiKey);
  const credential = await prisma.apiCredential.upsert({
    where: { customerId },
    create: { customerId, encryptedApiKey, baseUrl, workflowBaseUrl },
    update: { encryptedApiKey, baseUrl, workflowBaseUrl },
  });

  return NextResponse.json({ ok: true, baseUrl: credential.baseUrl, workflowBaseUrl: credential.workflowBaseUrl });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const credential = await prisma.apiCredential.findUnique({ where: { customerId } });
  if (!credential) return NextResponse.json({ configured: false });
  return NextResponse.json({ configured: true, baseUrl: credential.baseUrl, lastVerifiedAt: credential.lastVerifiedAt });
}

/** Verifies the stored key still authenticates against Zuper without exposing it back to the client. */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const credential = await prisma.apiCredential.findUnique({ where: { customerId } });
  if (!credential) return NextResponse.json({ error: "No credential saved" }, { status: 404 });

  const client = new ZuperClient(decryptSecret(credential.encryptedApiKey), credential.baseUrl);
  const ok = await client.testConnection();

  if (ok) {
    await prisma.apiCredential.update({ where: { customerId }, data: { lastVerifiedAt: new Date() } });
  }

  return NextResponse.json({ ok });
}
