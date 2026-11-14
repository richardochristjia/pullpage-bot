"use client";

import { useState } from "react";
import type { Format } from "../lib/geometry";

export default function CutAndPdf({ id, format, cut, approved, onDone }: { id: string; format: Format; cut: boolean; approved: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<"" | "cut" | "pdf">("");
  const [isCut, setIsCut] = useState(cut);
  const [isPdf, setIsPdf] = useState(approved);
  const [figmaUrl, setFigmaUrl] = useState("");
  const [error, setError] = useState("");

  async function post(step: "cut" | "approve") {
    setBusy(step === "cut" ? "cut" : "pdf");
    setError("");
    try {
      const res = await fetch(`/api/runs/${id}/${step}?format=${format}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed.");
      if (step === "cut") {
        setIsCut(true);
        setIsPdf(false);
        setFigmaUrl(body.figmaUrl ?? "");
      } else setIsPdf(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="pdf-tools">
      <ol className="steps">
        <li>
          <span className="label">1 Cut to Figma</span>
          <button className="btn" disabled={!!busy} onClick={() => post("cut")}>
            {busy === "cut" ? "Cutting…, about 30s" : isCut ? "Re-cut" : "Cut to Figma"}
          </button>
        </li>
        <li>
          <span className="label">2 Check in Figma</span>
          {figmaUrl && <a className="btn" href={figmaUrl} target="_blank" rel="noreferrer">Open cut in Figma</a>}
          <small>Edit inside the pieces, don&apos;t move them.</small>
        </li>
        <li>
          <span className="label">3 Make PDF</span>
          <button className="btn btn-primary" disabled={!!busy || !isCut} onClick={() => post("approve")}>
            {busy === "pdf" ? "Making PDF…, about 30s" : isPdf ? "Re-make PDF" : "Make PDF"}
          </button>
        </li>
        {isPdf && (
          <li>
            <span className="label">4 Download PDF</span>
            <a className="btn" href={`/api/runs/${id}/pdf?format=${format}`} download>Download PDF</a>
          </li>
        )}
      </ol>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
