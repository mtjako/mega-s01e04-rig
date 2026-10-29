import type { DigestRow, NightDigest } from '../digest/types.js';

function missing(value: string | null): string {
  return value ?? '—';
}

function DigestTable({ rows }: { rows: DigestRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">job</th>
          <th scope="col">owner</th>
          <th scope="col">runs</th>
          <th scope="col">retries</th>
          <th scope="col">last status</th>
          <th scope="col">last error</th>
          <th scope="col">first time</th>
          <th scope="col">last time</th>
          <th scope="col">failure seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr class={row.retries >= 3 || row.hasFailure ? 'warn' : undefined}>
            <td>{row.job}</td>
            <td>{missing(row.owner)}</td>
            <td>{row.runs}</td>
            <td>{row.retries}</td>
            <td>{row.lastStatus}</td>
            <td>{missing(row.lastError)}</td>
            <td>{row.firstAt}</td>
            <td>{row.lastAt}</td>
            <td>{row.hasFailure ? 'yes' : 'no'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Digest({ night, digest }: { night: string; digest: NightDigest }) {
  return (
    <>
      <h1>digest · {night}</h1>
      <p class="mute">invalid lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <DigestTable rows={digest.rows} />
      )}
    </>
  );
}
