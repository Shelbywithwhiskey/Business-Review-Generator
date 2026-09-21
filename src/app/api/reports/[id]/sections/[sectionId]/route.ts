import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sectionId: string }> }
) {
  const { sectionId } = await params;
  const body = await req.json();

  const section = await prisma.reportSection.update({
    where: { id: sectionId },
    data: {
      narrativeText: body.narrativeText,
      recommendationText: body.recommendationText,
      isEdited: true,
    },
  });

  return NextResponse.json({ section });
}
