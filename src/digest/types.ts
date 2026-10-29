export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner on the latest event; null is displayed as an em dash. */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  /** Number of valid retry events for this job. */
  retries: number;
  lastStatus: DigestStatus;
  /** Error on the latest event, or null when that event has no error. */
  lastError: string | null;
  /** Original timestamp strings, retaining their logged offsets. */
  firstAt: string;
  lastAt: string;
  /** True if any event failed, even when a later event recovered. */
  hasFailure: boolean;
};

/** Counts of valid log events, not counts of jobs or final job statuses. */
export type DigestCounts = Record<DigestStatus, number>;

export type NightDigest = {
  /** One row per job, sorted by job name in ascending order. */
  rows: DigestRow[];
  /** Nonblank lines that fail JSON parsing or event validation. */
  badLines: number;
  counts: DigestCounts;
};

/**
 * Synchronously read runsDir/<night>.jsonl, where night is YYYY-MM-DD.
 * Missing files return null. Empty files return empty rows and zero counts.
 * Invalid lines are counted and skipped; blank lines are ignored.
 * First/latest refer to event time; file order breaks equal-time ties.
 * Other filesystem errors propagate to the caller.
 *
 * The implementation exports readNight from ./reader.js; this is only its type.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
