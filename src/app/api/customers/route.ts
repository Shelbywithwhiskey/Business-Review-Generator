import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1),
  zuperAccountId: z.string().min(1),
  // Lenient on purpose — lib/website.ts normalizes bare domains (e.g. "acmepools.com") by prefixing https://.
  website: z.string().min(1).optional().or(z.literal("")),
  notes: z.string().optional(),
});

export async function GET() {
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      credential: { select: { lastVerifiedAt: true } },
      syncRuns: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const customer = await prisma.customer.create({
    data: { ...parsed.data, website: parsed.data.website || null },
  });
  return NextResponse.json({ customer }, { status: 201 });
}
