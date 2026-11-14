"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CutAndPdf from "../../../components/CutAndPdf";
import type { Format } from "../../../lib/geometry";
import type { Run, Step } from "../../../lib/runs";
import { PHASES, phaseOf, stepLabel } from "../../../lib/steps";

type Past = { id: string; name: string; formats: { format: Format; cut: boolean; approved: boolean }[] };

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const STATUS = { done: ["ok", "done"], running: ["live", "running"], failed: ["bad", "failed"], pending: ["wait", "waiting"] } as const;
const dur = (s: Step, now: number) => (s.startedAt ? (s.endedAt ?? now) - s.startedAt : 0);
// agy steps take about 3 min each.
const AGY = /^clean card \d+$|background$/;

function Img({ id, file, alt }: { id: string; file: string; alt: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <div className="nopreview">no preview</div> : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/runs/${id}/work?file=${file}`} alt={alt} onError={() => setBad(true)} />
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [lost, setLost] = useState<Past | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${id}`);
      if (res.ok) return setRun(await res.json());
      if (res.status !== 404) return;
      const list: Past[] = await fetch("/api/runs").then((r) => (r.ok ? r.json() : []));
      setLost(list.find((p) => p.id === id) ?? null);
    } catch {
      /* next poll retries */
    }
  }, [id]);

  useEffect(() => {
    document.title = "Run · pullpage-bot";
    load();
  }, [load]);

  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(load, 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [running, load]);

  if (lost === null) {
    return (
      <main className="wrap stack">
        <h1>Run not found</h1>
        <div className="banner err" role="alert">
          <p>This run is no longer in memory (the server restarted before it finished).</p>
        </div>
        <div className="row"><Link className="btn" href="/library">Library</Link><Link className="btn btn-primary" href="/">New run</Link></div>
      </main>
    );
  }
  if (lost) return <Finish id={id} name={lost.name} formats={lost.formats.map((f) => f.format)} flags={lost.formats} />;
  if (!run) return <main className="wrap" aria-busy="true"><div className="skel" /></main>;

  const end = running ? now : Math.max(run.startedAt, ...run.steps.map((s) => s.endedAt ?? 0));
  const elapsed = end - run.startedAt;
  const remaining = run.steps.filter((s) => AGY.test(s.label) && s.status !== "done").length;
  const failedStep = run.steps.find((s) => s.status === "failed");
  const phases = PHASES.map((p) => {
    const ss = run.steps.filter((s) => phaseOf(s.label) === p);
    const state = ss.some((s) => s.status === "failed") ? "failed" : ss.some((s) => s.status === "running") ? "live"
      : ss.length && ss.every((s) => s.status === "done") ? "done" : "pending";
    return { p, state, ms: ss.reduce((a, s) => a + dur(s, now), 0) };
  });
  const fmts = run.formats.join(" · ");

  const table = (
    <table className="table log">
      <thead><tr><th>Step</th><th>Status</th><th className="chk">Check</th><th className="num">Time</th></tr></thead>
      <tbody>
        {run.steps.flatMap((s) => {
          const [cls, word] = STATUS[s.status];
          return [
            <tr key={s.label} className={s.status === "running" ? "live-row" : undefined}>
              <td>{stepLabel(s.label, run.cards)}</td>
              <td><span className={`st ${cls}`}>{word}</span></td>
              <td className="chk">{s.status === "done" ? s.error : ""}</td>
              <td className="num">{s.startedAt ? mmss(dur(s, now)) : ""}</td>
            </tr>,
            s.status === "failed" && s.error && (
              <tr key={`${s.label}!`}><td colSpan={4} className="error" role="alert">{s.error}</td></tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );

  const sheet = run.formats.map((f) => {
    const st = run.steps.filter((s) => s.label.startsWith(`${f} `) && s.status === "done" && s.image && / (canvas|background|check)$/.test(s.label)).pop();
    return st && { f, file: st.image! };
  }).filter(Boolean) as { f: Format; file: string }[];
  const cleaned = run.cards.map((name, k) => {
    const st = run.steps.filter((s) => (s.label === `clean card ${k + 1} check` || s.label === `clean card ${k + 1}`) && s.status === "done" && s.image).pop();
    return st && { name, file: st.image! };
  }).filter(Boolean) as { name: string; file: string }[];

  const rail = (
    <aside className="rail" aria-label="Images">
      <h2 className="label">Sheet</h2>
      {sheet.length ? sheet.map((x) => <Img key={x.f} id={id} file={x.file} alt={`${x.f} sheet so far`} />) : <p className="hint">Nothing yet</p>}
      <h2 className="label">Cleaned cards</h2>
      {cleaned.length ? cleaned.map((x) => <Img key={x.name} id={id} file={x.file} alt={`${x.name}, cleaned`} />) : <p className="hint">Nothing yet</p>}
    </aside>
  );

  if (run.status === "done") {
    return (
      <Finish id={id} name={run.name} formats={run.formats} urls={Object.fromEntries(run.results.map((r) => [r.format, r.figmaUrl]))}
        banner={`Done in ${mmss(elapsed)}`} log={<details><summary>Log</summary>{table}</details>} />
    );
  }

  return (
    <main className="wrap stack">
      <div className="page-head">
        <h1>{run.name}</h1>
        <p className="meta">{fmts} · <b>{mmss(elapsed)}</b> elapsed{running && <> · {remaining ? <>left ~<b>{remaining * 3}</b> min</> : "finishing"}</>}</p>
      </div>
      <ol className="phases" aria-label="Phases">
        {phases.map((x) => (
          <li key={x.p} className={x.state}>
            <span className="label">{x.p}</span>
            <span className="num">{x.ms ? mmss(x.ms) : "–"}</span>
          </li>
        ))}
      </ol>
      {run.status === "failed" && (
        <div className="banner err" role="alert">
          <p>{failedStep ? `Failed at ${stepLabel(failedStep.label, run.cards)}.` : run.error ?? "The run failed."}</p>
          <div className="row">
            <Link className="btn btn-primary" href="/">Run again</Link>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(location.href).then(() => setCopied(true))}>{copied ? "Copied" : "Copy run link"}</button>
          </div>
        </div>
      )}
      <div className="wizard">{table}{rail}</div>
    </main>
  );
}

function Finish({ id, name, formats, urls = {}, flags, banner, log }: {
  id: string; name: string; formats: Format[]; urls?: Record<string, string>;
  flags?: Past["formats"]; banner?: string; log?: React.ReactNode;
}) {
  return (
    <main className="wrap stack">
      <div className="page-head"><h1>{name}</h1></div>
      <div className="banner ok" role="status">{banner ?? "Finished"}</div>
      {log}
      <div className="runs finish">
        {formats.map((f) => (
          <section key={f} className="run" aria-label={f}>
            <span className="label">{f}</span>
            <div className="run-fmt">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/runs/${id}/image?format=${f}`} alt={`${name}, ${f}`} />
              <div className="stack">
                {urls[f] && <a className="btn" href={urls[f]} target="_blank" rel="noreferrer">Open in Figma</a>}
                <CutAndPdf id={id} format={f} cut={!!flags?.find((x) => x.format === f)?.cut} approved={!!flags?.find((x) => x.format === f)?.approved} onDone={() => {}} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
