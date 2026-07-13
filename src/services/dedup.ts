/**
 * Duplicate-employer merge. The same company often arrives from multiple sources
 * (Bundesagentur, Adzuna, Jooble...) as separate Employer rows, splitting its
 * vacancies, email, and outreach history. This merges rows that are confidently
 * the same company into one canonical record.
 *
 * Conservative match key: normalized name + region + city. Differing city (when
 * both are known) blocks a merge, so two same-named hotels in different towns
 * stay separate. Runs nightly; safe to re-run (idempotent once merged).
 */

import { prisma } from "@/lib/prisma";
import type { SponsorshipSignal } from "@prisma/client";
import { normalizeEmployerName, normalizeDomain, domainOfEmail } from "@/lib/normalize";

const EMP_SELECT = {
  id: true, name: true, region: true, city: true, genericEmail: true,
  score: true, sponsorshipSignal: true, optedOut: true, bouncedEmails: true,
  website: true, createdAt: true,
} as const;

type Emp = { id: string; name: string; region: string | null; city: string | null;
  genericEmail: string | null; score: number; sponsorshipSignal: SponsorshipSignal; optedOut: boolean;
  bouncedEmails: string[]; website: string | null; createdAt: Date };

/**
 * Merge employers into canonical rows. Two passes on freshly-queried data:
 *   1. normalized name + region + city  (conservative: same name, same place)
 *   2. shared real domain (website / generic-email host, excluding free webmail)
 * Same domain ⇒ same company, even across differing city spellings.
 */
export async function mergeDuplicateEmployers(): Promise<{ groups: number; merged: number }> {
  const byName = await mergeByKey(
    (e) => {
      const n = normalizeEmployerName(e.name);
      return n.length < 3 ? null : `${n}|${(e.region ?? "").toLowerCase()}|${(e.city ?? "").toLowerCase()}`;
    }
  );
  const byDomain = await mergeByKey((e) => normalizeDomain(e.website) ?? domainOfEmail(e.genericEmail));
  return { groups: byName.groups + byDomain.groups, merged: byName.merged + byDomain.merged };
}

// Bucket freshly-queried employers by keyFn (null key = skip) and fold each
// bucket of ≥2 into a single canonical row.
async function mergeByKey(keyFn: (e: Emp) => string | null): Promise<{ groups: number; merged: number }> {
  const employers = (await prisma.employer.findMany({ select: EMP_SELECT })) as Emp[];

  const buckets = new Map<string, Emp[]>();
  for (const e of employers) {
    const key = keyFn(e);
    if (!key) continue;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(e);
  }

  let groups = 0;
  let merged = 0;

  for (const group of Array.from(buckets.values())) {
    if (group.length < 2) continue;
    groups++;

    try {
    // Canonical = has email > highest score > oldest. The rest get folded in.
    const canonical = [...group].sort((a, b) => {
      const ae = a.genericEmail ? 1 : 0, be = b.genericEmail ? 1 : 0;
      if (ae !== be) return be - ae;
      if (a.score !== b.score) return b.score - a.score;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
    const dupIds = group.filter((e) => e.id !== canonical.id).map((e) => e.id);
    if (dupIds.length === 0) continue;

    // Reassign all children to the canonical employer.
    await prisma.vacancy.updateMany({ where: { employerId: { in: dupIds } }, data: { employerId: canonical.id } });
    await prisma.match.updateMany({ where: { employerId: { in: dupIds } }, data: { employerId: canonical.id } });
    await prisma.employerSignalLog.updateMany({ where: { employerId: { in: dupIds } }, data: { employerId: canonical.id } });

    // Fold scalar fields: keep any email/website, union bounced, OR opt-out,
    // keep the strongest sponsorship signal.
    const dups = group.filter((e) => dupIds.includes(e.id));
    const bounced = Array.from(new Set([...(canonical.bouncedEmails ?? []), ...dups.flatMap((d) => d.bouncedEmails ?? [])]));
    const email = canonical.genericEmail ?? dups.find((d) => d.genericEmail)?.genericEmail ?? null;
    const website = canonical.website ?? dups.find((d) => d.website)?.website ?? null;
    const optedOut = canonical.optedOut || dups.some((d) => d.optedOut);
    const order = ["YES", "LIKELY", "UNKNOWN", "NO"];
    const signal = [canonical, ...dups]
      .map((e) => e.sponsorshipSignal)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];

    await prisma.employer.update({
      where: { id: canonical.id },
      data: {
        bouncedEmails: bounced,
        ...(email ? { genericEmail: email } : {}),
        ...(website ? { website } : {}),
        optedOut,
        sponsorshipSignal: signal,
      },
    });

    // Drop now-empty duplicate employers.
    await prisma.employer.deleteMany({ where: { id: { in: dupIds } } });
    merged += dupIds.length;
    } catch {
      // One unmergeable group (e.g. a unique-constraint edge case) must not stop the rest.
    }
  }

  return { groups, merged };
}
