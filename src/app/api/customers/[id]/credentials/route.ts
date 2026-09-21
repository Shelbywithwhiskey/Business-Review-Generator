import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ZuperClient } from "@/lib/zuper/client";

const schema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const encryptedApiKey = encryptSecret(parsed.data.apiKey);
  const baseUrl = parsed.data.baseUrl ?? process.env.ZUPER_API_BASE_URL ?? "https://api.zuperpro.com";

  const credential = await prisma.apiCredential.upsert({
    where: { customerId },
    create: { customerId, encryptedApiKey, baseUrl },
    update: { encryptedApiKey, baseUrl },
  });

  return NextResponse.json({ ok: true, baseUrl: credential.baseUrl });
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
