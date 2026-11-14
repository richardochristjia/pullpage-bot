"use client";

import { useState } from "react";

type LineStatus = { url: string; text: string; ok: boolean; pdf?: string; wait?: boolean };
const toLines = (t: string) => [...new Set(t.split("\n").map((s) => s.trim()).filter(Boolean))];

export default function LinkTools() {
  const [cutText, setCutText] = useState("");
  const [exportText, setExportText] = useState("");
  const [cutStatus, setCutStatus] = useState<LineStatus[]>([]);
  const [exportStatus, setExportStatus] = useState<LineStatus[]>([]);
  const [busy, setBusy] = useState<"" | "cut" | "export">("");

  async function runAll(kind: "cut" | "export") {
    const set = kind === "cut" ? setCutStatus : setExportStatus;
    setBusy(kind);
    const urls = toLines(kind === "cut" ? cutText : exportText);
    set(urls.map((url, i) => ({ url, text: i ? "waiting" : "running", ok: true, wait: true })));
    for (const [i, url] of urls.entries()) {
      set((p) => p.map((r, j) => (j === i ? { ...r, text: "running" } : r)));
      let st: LineStatus;
      try {
        const res = await fetch(`/api/links/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Request failed.");
        if (kind === "cut") {
          st = { url, text: `done · ${body.format}`, ok: true };
          setExportText((prev) =>
            toLines(prev).includes(body.cutUrl) ? prev : (prev.trim() ? prev.trimEnd() + "\n" : "") + body.cutUrl,
          );
        } else st = { url, text: `done · ${body.format} · ${body.pages} pages`, ok: true, pdf: body.pdf };
      } catch (e) {
        st = { url, text: e instanceof Error ? e.message : String(e), ok: false };
      }
      set((p) => p.map((r, j) => (j === i ? st : r)));
    }
    setBusy("");
  }

  const list = (rows: LineStatus[]) =>
    rows.length > 0 && (
      <ul className="line-list">
        {rows.map((r) => (
          <li key={r.url} className={r.ok ? (r.wait ? "muted" : undefined) : "bad"}>
            {r.url.slice(-40)}: {r.text}{" "}
            {r.pdf && <a className="btn" href={r.pdf} download>Download PDF</a>}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="links-grid">
      <section className="box stack">
        <h2>Frames to cut</h2>
        <div className="field">
          <label htmlFor="cut-links">Figma frame links</label>
          <textarea id="cut-links" className="input" rows={6} placeholder="One Figma frame link per line" value={cutText} onChange={(e) => setCutText(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={!!busy || !toLines(cutText).length} onClick={() => runAll("cut")}>
            {busy === "cut" ? "Cutting…, about 30s each" : "Cut"}
          </button>
        </div>
        {list(cutStatus)}
      </section>
      <section className="box stack">
        <h2>Cut frames to export</h2>
        <div className="field">
          <label htmlFor="export-links">Cut frame links</label>
          <textarea id="export-links" className="input" rows={6} placeholder="One cut frame link per line" value={exportText} onChange={(e) => setExportText(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={!!busy || !toLines(exportText).length} onClick={() => runAll("export")}>
            {busy === "export" ? "Exporting…, about 30s each" : "Export"}
          </button>
        </div>
        <small>Check the cut frames in Figma first. Export runs only when you click.</small>
        {list(exportStatus)}
      </section>
    </div>
  );
}
