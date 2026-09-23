import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      credential: { select: { baseUrl: true, lastVerifiedAt: true } },
      syncRuns: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ customer });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const customer = await prisma.customer.update({
    where: { id },
    data: {
      name: body.name,
      zuperAccountId: body.zuperAccountId,
      website: body.website === "" ? null : body.website,
      notes: body.notes,
    },
  });
  return NextResponse.json({ customer });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.customer.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
