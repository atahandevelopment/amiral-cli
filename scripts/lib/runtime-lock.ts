/**
 * Cross-invocation runtime lock.
 *
 * The long-lived, user-visible ownership record is `.amiral/amiral.lock`:
 * `{ pid, started_at, command, token }`.  Acquisition and stale takeover are
 * serialized by proper-lockfile using the distinct `amiral.lock.guard`
 * directory.  The guard has a 2s stale timeout, a 1s heartbeat, and four
 * bounded retries (50ms minimum delay, 200ms maximum, factor 1.5).
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { lock as acquireMutex } from "proper-lockfile";

export type LockInfo = {
  pid: number;
  started_at: string;
  command: string;
  token?: string;
};

export type LockHandle = {
  path: string;
  pid: number;
  command: string;
  startedAt: string;
  token: string;
  tookOver: boolean;
};

export class LockError extends Error {
  pid?: number;
  startedAt?: string;
  command?: string;

  constructor(message: string, details: { pid?: number; startedAt?: string; command?: string } = {}) {
    super(message);
    this.name = "LockError";
    if (details.pid !== undefined) this.pid = details.pid;
    if (details.startedAt !== undefined) this.startedAt = details.startedAt;
    if (details.command !== undefined) this.command = details.command;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

function lockPath(): string {
  return resolve(process.cwd(), ".amiral", "amiral.lock");
}

async function readLockFile(path: string): Promise<LockInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<LockInfo> | null;
    if (!parsed || typeof parsed !== "object" || !Number.isInteger(Number(parsed.pid))) return null;
    return {
      pid: Number(parsed.pid),
      started_at: typeof parsed.started_at === "string" ? parsed.started_at : "",
      command: typeof parsed.command === "string" ? parsed.command : "",
      ...(typeof parsed.token === "string" ? { token: parsed.token } : {}),
    };
  } catch {
    return null;
  }
}

function describeHolder(info: LockInfo): string {
  const parts = [`pid ${info.pid}`];
  if (info.started_at) parts.push(`started at ${info.started_at}`);
  if (info.command) parts.push(`command "${info.command}"`);
  return parts.join(", ");
}

function holderError(path: string, info: LockInfo): LockError {
  return new LockError(
    `Another Amiral command is already running (${describeHolder(info)}). If the process is no longer running, retry; stale ownership is recovered automatically. Lock: ${path}`,
    {
      pid: info.pid,
      ...(info.started_at ? { startedAt: info.started_at } : {}),
      ...(info.command ? { command: info.command } : {}),
    },
  );
}

export async function acquireLock(command: string): Promise<LockHandle> {
  const path = lockPath();
  const guardPath = `${path}.guard`;
  await mkdir(dirname(path), { recursive: true });

  let releaseMutex: (() => Promise<void>) | undefined;
  try {
    releaseMutex = await acquireMutex(path, {
      lockfilePath: guardPath,
      realpath: false,
      stale: 2_000,
      update: 1_000,
      retries: { retries: 4, factor: 1.5, minTimeout: 50, maxTimeout: 200, randomize: true },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new LockError(`Runtime lock acquisition is busy. Retry shortly; an abandoned acquisition mutex recovers automatically. Lock: ${path}`);
    }
    throw error;
  }

  try {
    const current = await readLockFile(path);
    if (current && isProcessAlive(current.pid)) throw holderError(path, current);

    let tookOver = false;
    try {
      await stat(path);
      const quarantine = `${path}.stale-${randomUUID()}`;
      await rename(path, quarantine);
      tookOver = true;
      await rm(quarantine, { force: true }).catch(() => {});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const startedAt = new Date().toISOString();
    const token = randomUUID();
    const contents = `${JSON.stringify({ pid: process.pid, started_at: startedAt, command, token }, null, 2)}\n`;
    let file;
    try {
      file = await open(path, "wx", 0o600);
      await file.writeFile(contents, "utf8");
      await file.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LockError(`Runtime lock was acquired by another contender: ${path}`);
      }
      throw error;
    } finally {
      await file?.close().catch(() => {});
    }
    return { path, pid: process.pid, command, startedAt, token, tookOver };
  } finally {
    await releaseMutex();
  }
}

export async function releaseLock(handle: LockHandle): Promise<void> {
  const current = await readLockFile(handle.path);
  if (current?.pid === handle.pid && current.token === handle.token) {
    await rm(handle.path, { force: true }).catch(() => {});
  }
}

export async function withLock<T>(command: string, fn: () => Promise<T>): Promise<T> {
  const handle = await acquireLock(command);
  try {
    return await fn();
  } finally {
    await releaseLock(handle);
  }
}
