import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const empty = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };
const directories: string[] = [];

function runsDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  directories.push(directory);
  return directory;
}

function writeEvents(directory: string, events: unknown[]): void {
  writeFileSync(join(directory, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('readNight', () => {
  it('aggregates the real sample without changing its logged offsets', () => {
    const digest = readNight('runs', night);
    expect(digest).toEqual({
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00', hasFailure: false },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00', hasFailure: true },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00', hasFailure: false },
      ],
    });
  });

  it('distinguishes missing nights from empty or blank nights', () => {
    const directory = runsDir();
    expect(readNight(directory, night)).toBeNull();
    writeFileSync(join(directory, `${night}.jsonl`), '');
    expect(readNight(directory, night)).toEqual(empty);
    writeFileSync(join(directory, `${night}.jsonl`), '\n \r\n\t\n');
    expect(readNight(directory, night)).toEqual(empty);
  });

  it('rejects path traversal and invalid calendar dates before reading files', () => {
    const directory = runsDir();
    const nested = join(directory, 'nested');
    mkdirSync(nested);
    writeEvents(directory, [event]);
    for (const invalid of ['../2026-10-28', `${directory}/${night}`, '2026-10-28/../2026-10-28',
      '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-00', '2026-1-01', '2026-10-28\n', '']) {
      expect(readNight(nested, invalid)).toBeNull();
    }
    writeFileSync(join(directory, '2028-02-29.jsonl'), '');
    expect(readNight(directory, '2028-02-29')).toEqual(empty);
  });

  it('counts invalid JSON, event shapes, and times while reading valid lines around them', () => {
    const directory = runsDir();
    const invalid = [null, [], true, 1, 'text', {},
      { ...event, at: null }, { ...event, at: 'not a date' },
      { ...event, at: '2026-02-30T10:00:00Z' }, { ...event, at: '2026-10-28T24:00:00Z' },
      { ...event, at: '2026-10-28T10:00:00' }, { ...event, at: '2026-10-28T10:00:00+25:00' },
      { ...event, job: 12 }, { ...event, status: 'success' },
      { ...event, owner: undefined }, { ...event, owner: false }, { ...event, error: 12 },
    ];
    const filename = join(directory, `${night}.jsonl`);
    // A malformed line between valid lines must not abort the night.
    writeFileSync(filename, `${JSON.stringify(event)}\r\n{broken\r\n${invalid.map((value) => JSON.stringify(value)).join('\r\n')}\r\n\t\r\n${JSON.stringify({ ...event, owner: null })}`);
    expect(readNight(directory, night)).toEqual({
      rows: [{ job: 'job', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: event.at, lastAt: event.at, hasFailure: false }],
      badLines: invalid.length + 1,
      counts: { ok: 2, retry: 0, fail: 0 },
    });
  });

  it('orders by instants, retains timestamp offsets, and remembers a recovered failure', () => {
    const directory = runsDir();
    writeEvents(directory, [
      { ...event, at: '2026-10-28T23:00:00-02:00', owner: null },
      { ...event, at: '2026-10-29T02:00:00+03:00', status: 'fail', error: 'failed' },
      { ...event, at: '2026-10-29T00:00:00Z', status: 'retry', error: 'retrying' },
    ]);
    expect(readNight(directory, night)).toEqual({
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T02:00:00+03:00', lastAt: '2026-10-28T23:00:00-02:00', hasFailure: true }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('breaks equal-time ties by file order and sorts jobs deterministically', () => {
    const directory = runsDir();
    writeEvents(directory, [
      { ...event, job: 'z' },
      { ...event, job: '__proto__', owner: null },
      { ...event, job: 'A' },
      { ...event, job: 'z', at: '2026-10-28T22:00:00Z', status: 'retry', owner: 'new', error: 'latest' },
    ]);
    const digest = readNight(directory, night);
    expect(digest?.rows.map((row) => row.job)).toEqual(['A', '__proto__', 'z']);
    expect(digest?.rows[2]).toEqual({ job: 'z', owner: 'new', runs: 2, retries: 1,
      firstAt: event.at, lastAt: '2026-10-28T22:00:00Z', lastStatus: 'retry', lastError: 'latest', hasFailure: false });
  });

  it('returns an empty digest with bad-line counts when every event is invalid', () => {
    const directory = runsDir();
    writeEvents(directory, [null, { ...event, status: 'unknown' }]);
    expect(readNight(directory, night)).toEqual({ ...empty, badLines: 2 });
  });

  it('propagates filesystem errors other than a missing file', () => {
    const directory = runsDir();
    mkdirSync(join(directory, `${night}.jsonl`));
    expect(() => readNight(directory, night)).toThrow();
  });
});
