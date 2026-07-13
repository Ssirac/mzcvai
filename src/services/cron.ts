/**
 * Cron orchestration: a DB-based distributed lock so overlapping ticks or a
 * second instance never run the same job twice, plus a persisted CronRun record
 * (status/duration/result) for the admin UI. Idempotency of the work itself lives
 * in the individual services; this guarantees single-flight execution.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Try to acquire the named lock. Returns the owner token on success, else null.
// Exported for callers (e.g. the long nightly handler) that must hold the lock
// across their whole body rather than a single wrapped fn.
export async function acquireCronLock(name: string, ttlMs: number): Promise<string | null> {
  return acquire(name, ttlMs);
}
export async function releaseCronLock(name: string, owner: string): Promise<void> {
  return release(name, owner);
}

async function acquire(name: string, ttlMs: number): Promise<string | null> {
  const owner = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.cronLock.create({ data: { name, owner, expiresAt } });
    return owner;
  } catch {
    // Lock exists — steal it only if expired (atomic conditional update).
    const stolen = await prisma.cronLock.updateMany({
      where: { name, expiresAt: { lt: now } },
      data: { owner, expiresAt, lockedAt: now },
    });
    return stolen.count > 0 ? owner : null;
  }
}

async function release(name: string, owner: string): Promise<void> {
  await prisma.cronLock.deleteMany({ where: { name, owner } }).catch(() => {});
}

export interface CronOutcome<T> {
  ran: boolean;
  skipped?: "locked";
  result?: T;
  error?: string;
  durationMs?: number;
}

/**
 * Run `fn` under a single-flight lock and record a CronRun. If the lock is held,
 * returns { ran:false, skipped:"locked" } without running.
 */
export async function withCronLock<T>(job: string, ttlMs: number, fn: () => Promise<T>): Promise<CronOutcome<T>> {
  const owner = await acquire(job, ttlMs);
  if (!owner) {
    await prisma.cronRun.create({ data: { job, status: "skipped_locked", finishedAt: new Date(), durationMs: 0 } }).catch(() => {});
    return { ran: false, skipped: "locked" };
  }

  const run = await prisma.cronRun.create({ data: { job, status: "running" } }).catch(() => null);
  const started = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - started;
    if (run) {
      await prisma.cronRun.update({
        where: { id: run.id },
        data: { status: "completed", finishedAt: new Date(), durationMs, result: result as Prisma.InputJsonValue },
      }).catch(() => {});
    }
    return { ran: true, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - started;
    const error = (err as Error).message;
    if (run) {
      await prisma.cronRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), durationMs, error },
      }).catch(() => {});
    }
    return { ran: false, error, durationMs };
  } finally {
    await release(job, owner);
  }
}
