import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/audit?action=&limit= — recent audit-trail entries (newest first).
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
    const items = await prisma.auditLog.findMany({
      where: action ? { action } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    return apiError(err);
  }
}
