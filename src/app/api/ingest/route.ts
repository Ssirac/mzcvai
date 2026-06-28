import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/apiError";
import { scoreEmployersForSearch } from "@/services/scoring";
import { SOURCES, availableSources, getSource } from "@/services/sources/registry";
import { prisma } from "@/lib/prisma";
import { PART_TIME_TITLE_KEYWORDS } from "@/lib/berufMap";

// POST /api/ingest
// Body: { beruf, region, maxPages?, source? }  — source = a module id or "all".
// Runs the selected source module(s) from the registry, upserts into the DB,
// then scores employers. Each platform is its own module (see sources/registry).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const beruf: string = (body.beruf ?? "").trim();
    const region: string = (body.region ?? "Deutschland").trim();
    const source: string = body.source ?? "all";
    // When not specified, each source module uses its own sensible page default
    // (aggregators fetch more than the already-large Bundesagentur).
    const maxPages: number | undefined = body.maxPages ? Math.min(body.maxPages, 10) : undefined;

    if (!beruf) {
      return NextResponse.json({ error: "beruf (occupation) is required" }, { status: 400 });
    }

    // Resolve which source modules to run
    const modules =
      source === "all"
        ? availableSources()
        : (() => {
            const s = getSource(source);
            if (!s) return [];
            return [s];
          })();

    if (modules.length === 0) {
      return NextResponse.json({ error: `Unknown or unavailable source: ${source}` }, { status: 400 });
    }

    const totals = { vacanciesNew: 0, vacanciesUpdated: 0, employersNew: 0, errors: [] as string[] };
    const perSource: Record<string, { vacanciesNew: number; employersNew: number; errors: number }> = {};

    for (const mod of modules) {
      if (!mod.available()) {
        totals.errors.push(`${mod.label}: ${mod.unavailableReason ?? "not available"}`);
        continue;
      }
      try {
        const r = await mod.ingest({ beruf, region, keywords: body.keywords, maxPages });
        totals.vacanciesNew += r.vacanciesNew;
        totals.vacanciesUpdated += r.vacanciesUpdated;
        totals.employersNew += r.employersNew;
        totals.errors.push(...r.errors);
        perSource[mod.id] = { vacanciesNew: r.vacanciesNew, employersNew: r.employersNew, errors: r.errors.length };
      } catch (err) {
        totals.errors.push(`${mod.id}: ${(err as Error).message}`);
      }
    }

    const scored = await scoreEmployersForSearch(beruf, region);

    // Remove any part-time / mini-job vacancies that slipped in (title-based cleanup)
    const { count: partTimeDeleted } = await prisma.vacancy.deleteMany({
      where: {
        OR: PART_TIME_TITLE_KEYWORDS.map((kw) => ({
          title: { contains: kw, mode: "insensitive" as const },
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      vacanciesNew: totals.vacanciesNew,
      vacanciesUpdated: totals.vacanciesUpdated,
      employersNew: totals.employersNew,
      employersScored: scored,
      partTimeDeleted,
      sourcesRun: modules.map((m) => m.id),
      perSource,
      errors: totals.errors,
    });
  } catch (err) {
    console.error("[/api/ingest]", err);
    return apiError(err);
  }
}

// GET /api/ingest — list all source modules and their availability (for the UI)
export async function GET() {
  return NextResponse.json({
    sources: SOURCES.map((s) => ({
      id: s.id,
      label: s.label,
      category: s.category,
      available: s.available(),
      reason: s.available() ? null : s.unavailableReason ?? null,
    })),
  });
}
