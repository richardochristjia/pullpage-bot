"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CutAndPdf from "../../components/CutAndPdf";
import type { Format } from "../../lib/geometry";

type PastRun = { id: string; name: string; createdAt: string; formats: { format: Format; cut: boolean; approved: boolean }[] };

export default function LibraryPage() {
  const [runs, setRuns] = useState<PastRun[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRuns)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    document.title = "Library · pullpage-bot";
    load();
  }, [load]);

  return (
    <main className="wrap stack">
      <div className="page-head">
        <h1>Library</h1>
        {runs && runs.length > 0 && <p className="meta"><b>{runs.length}</b> runs</p>}
      </div>
      {failed ? (
        <div className="banner err" role="alert">
          <p>Could not load runs.</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      ) : !runs ? (
        <div className="runs" aria-busy="true" aria-label="Loading runs">
          <div className="skel" /><div className="skel" /><div className="skel" />
        </div>
      ) : runs.length === 0 ? (
        <div className="empty">
          <p>No runs yet</p>
          <Link className="btn btn-primary" href="/">New run</Link>
        </div>
      ) : (
        <div className="runs">
          {runs.map((p) => (
            <section key={p.id} className="run" aria-label={p.name}>
              <div className="run-head">
                <h2>{p.name}</h2>
                <span className="meta">{new Date(p.createdAt).toLocaleString()}</span>
              </div>
              {p.formats.map((f) => (
                <div key={f.format} className="run-fmt">
                  <a href={`/api/runs/${p.id}/image?format=${f.format}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/runs/${p.id}/image?format=${f.format}`} alt={`${p.name}, ${f.format}`} />
                  </a>
                  <div className="stack">
                    <div className="row">
                      <span className="label">{f.format}</span>
                      <span className={`st ${f.approved ? "ok" : f.cut ? "warn" : "wait"}`}>{f.approved ? "pdf ready" : f.cut ? "cut" : "not cut"}</span>
                    </div>
                    <CutAndPdf id={p.id} format={f.format} cut={f.cut} approved={f.approved} onDone={load} />
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
