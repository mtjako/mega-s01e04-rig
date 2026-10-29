import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const hostileJob = '<script>alert("x")</script>';
const night = '2026-10-28';

let runsDir: string;

function writeNight(name: string, contents: string): void {
  writeFileSync(join(runsDir, `${name}.jsonl`), contents, 'utf8');
}

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves the same sorted jobs from HTML and JSON, escaping and retaining log details', async () => {
    writeNight(
      night,
      [
        JSON.stringify({ at: '2026-10-28T03:00:00+02:00', job: 'recovering', status: 'ok', owner: 'Sam' }),
        JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: hostileJob, status: 'ok', owner: null }),
        JSON.stringify({ at: '2026-10-28T02:00:00+02:00', job: 'recovering', status: 'fail', owner: 'Sam', error: 'temporary outage' }),
        JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'retrying', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T02:00:00+01:00', job: 'retrying', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T03:00:00+01:00', job: 'retrying', status: 'retry', owner: 'Lee' }),
      ].join('\n'),
    );

    const [jsonResponse, htmlResponse] = await Promise.all([
      app().request(`/api/digest/${night}`),
      app().request(`/digest/${night}`),
    ]);
    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.status).toBe(200);

    const digest = (await jsonResponse.json()) as NightDigest;
    expect(digest.rows.map((row) => row.job)).toEqual([
      hostileJob,
      'recovering',
      'retrying',
    ]);
    expect(digest.badLines).toBe(0);
    expect(digest.counts).toEqual({ ok: 2, retry: 3, fail: 1 });
    expect(digest.rows[0]).toMatchObject({ owner: null, firstAt: '2026-10-28T01:00:00+01:00' });
    expect(digest.rows[1]).toMatchObject({
      lastStatus: 'ok',
      firstAt: '2026-10-28T02:00:00+02:00',
      lastAt: '2026-10-28T03:00:00+02:00',
      hasFailure: true,
    });
    expect(digest.rows[2]).toMatchObject({ retries: 3 });

    const html = await htmlResponse.text();
    const escapedHostileJob = '&lt;script&gt;alert(';
    expect(html).not.toContain(hostileJob);
    expect(html).toContain(escapedHostileJob);
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T02:00:00+02:00');
    expect(html).toContain('2026-10-28T03:00:00+02:00');

    const bodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    expect(bodyMatch).toBeDefined();
    const body = bodyMatch?.[1] ?? '';
    expect(body.match(/<tr class="warn">/g) ?? []).toHaveLength(2);
    const htmlJobOrder = [escapedHostileJob, 'recovering', 'retrying'].map((job) => body.indexOf(job));
    expect(htmlJobOrder.every((index) => index >= 0)).toBe(true);
    expect(htmlJobOrder).toEqual([...htmlJobOrder].sort((left, right) => left - right));
  });

  it('returns 404 for a night with no file on both routes', async () => {
    const [jsonResponse, htmlResponse] = await Promise.all([
      app().request('/api/digest/2026-10-27'),
      app().request('/digest/2026-10-27'),
    ]);

    expect(jsonResponse.status).toBe(404);
    expect(htmlResponse.status).toBe(404);
  });

  it('returns an empty digest and renders the empty-night message for an empty file', async () => {
    writeNight('2026-10-26', '');
    const [jsonResponse, htmlResponse] = await Promise.all([
      app().request('/api/digest/2026-10-26'),
      app().request('/digest/2026-10-26'),
    ]);

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
  });

  it('counts malformed lines while keeping valid route data available', async () => {
    writeNight(
      '2026-10-25',
      [
        '{this is not JSON',
        JSON.stringify({ at: '2026-10-25T08:30:00-04:00', job: 'valid-job', status: 'ok', owner: 'Ari' }),
      ].join('\n'),
    );
    const [jsonResponse, htmlResponse] = await Promise.all([
      app().request('/api/digest/2026-10-25'),
      app().request('/digest/2026-10-25'),
    ]);

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toMatchObject({
      badLines: 1,
      rows: [{ job: 'valid-job', firstAt: '2026-10-25T08:30:00-04:00' }],
    });
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('invalid lines: 1');
    expect(html).toContain('valid-job');
  });
});
