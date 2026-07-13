import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/services/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/candidates/[id]/gdpr — GDPR data export (Art. 15/20). Returns ALL
 * personal data held about the candidate as a downloadable JSON, including the
 * CV bytes (base64) and every related record (matches, outreach, applications).
 * The export itself is audited.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [matches, applications, captcha] = await Promise.all([
      prisma.match.findMany({
        where: { candidateId: id },
        select: {
          fitScore: true, fitBreakdown: true, status: true, createdAt: true,
          employer: { select: { name: true, city: true } },
          vacancy: { select: { title: true, url: true, source: true } },
          outreach: { select: { subject: true, status: true, toAddress: true, sentAt: true, replyText: true, replyFrom: true } },
        },
      }),
      prisma.jobApplicationLog.findMany({ where: { candidateId: id } }),
      prisma.captchaQueue.findMany({ where: { candidateId: id }, select: { company: true, jobTitle: true, status: true, createdAt: true } }),
    ]);

    const { cvData, ...profile } = candidate;
    const data = {
      exportedAt: new Date().toISOString(),
      profile,
      cv: cvData
        ? { fileName: candidate.cvFileName, mimeType: candidate.cvMimeType, base64: Buffer.from(cvData).toString("base64") }
        : null,
      matches,
      applications,
      captchaQueue: captcha,
    };

    await logAudit({ actor: await getSessionUser(req), action: "GDPR_EXPORT", targetType: "candidate", targetId: id });

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="gdpr-export-${id}.json"`,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
