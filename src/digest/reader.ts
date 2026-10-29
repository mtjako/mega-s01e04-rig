import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

type LogEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const instant = Date.parse(`${night}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === night;
}

function isTimestamp(at: string): boolean {
  // Require an explicit offset so ordering never depends on the server's timezone.
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(at);
  return match !== null && isNight(match[1]) && Number.isFinite(Date.parse(at));
}

function isLogEvent(value: unknown): value is LogEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && isTimestamp(event.at)
    && typeof event.job === 'string'
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (event.owner === null || typeof event.owner === 'string')
    && (event.error === undefined || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  // Validate before constructing a path, including real calendar dates.
  if (!isNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number }>();

  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (!isLogEvent(event)) {
      digest.badLines++;
      continue;
    }

    digest.counts[event.status]++;
    const instant = Date.parse(event.at);
    const existing = jobs.get(event.job);
    if (!existing) {
      jobs.set(event.job, {
        first: instant,
        last: instant,
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
          hasFailure: event.status === 'fail',
        },
      });
      continue;
    }

    const { row } = existing;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (instant < existing.first) {
      existing.first = instant;
      row.firstAt = event.at;
    }
    // Later lines win equal-time ties; the first line keeps firstAt.
    if (instant >= existing.last) {
      existing.last = instant;
      row.lastAt = event.at;
      row.owner = event.owner;
      row.lastStatus = event.status;
      row.lastError = event.error ?? null;
    }
  }

  digest.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
