"use client";

import { useEffect, useRef, useState } from "react";

type Format = "binder" | "toploader";
type RunView = {
  id: string;
  status: "running" | "done" | "failed";
  steps: { label: string; status: string; error?: string }[];
  results: { format: Format; figmaUrl: string }[];
};
type Card = { file: File; url: string; cell: number };

type PastRun = { id: string; name: string; createdAt: string; formats: { format: Format; approved: boolean }[] };

const DEFAULT_CELLS = [4, 5, 3];

function Approve({ id, format, approved, onDone }: { id: string; format: Format; approved: boolean; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "error" | "done">("idle");
  const [message, setMessage] = useState("");
  const isDone = approved || state === "done";

  async function approve() {
    setState("busy");
    try {
      const res = await fetch(`/api/runs/${id}/approve?format=${format}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Approve failed.");
      setState("done");
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  return (
    <span>
      <button disabled={state === "busy"} onClick={approve}>
        {state === "busy" ? "Cutting…, about 30s" : isDone ? "Re-approve" : "Approve"}
      </button>
      {isDone && (
        <>
          {" "}
          <a href={`/api/runs/${id}/pdf?format=${format}`} download>Download PDF</a>
        </>
      )}
      {state === "error" && <span style={{ color: "#f66" }}> {message}</span>}
    </span>
  );
}

export default function Page() {
  const [cards, setCards] = useState<Card[]>([]);
  const [formats, setFormats] = useState<Format[]>(["binder"]);
  const [name, setName] = useState("");
  const [run, setRun] = useState<RunView | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [past, setPast] = useState<PastRun[]>([]);
  const poll = useRef<ReturnType<typeof setInterval>>(undefined);

  const running = run?.status === "running";
  const cells = cards.map((c) => c.cell);
  const valid = cards.length > 0 && formats.length > 0 && new Set(cells).size === cells.length;

  function addFiles(files: FileList | File[]) {
    setCards((prev) => {
      const next = [...prev];
      for (const file of Array.from(files)) {
        if (next.length >= 3 || !file.type.startsWith("image/")) continue;
        const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !next.some((c) => c.cell === i));
        const cell = free.includes(DEFAULT_CELLS[next.length]) ? DEFAULT_CELLS[next.length] : free[0];
        next.push({ file, url: URL.createObjectURL(file), cell });
      }
      return next;
    });
  }

  const toggleFormat = (f: Format) =>
    setFormats((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]));

  async function start() {
    setErrors([]);
    const form = new FormData();
    cards.forEach((c) => form.append("cards", c.file));
    form.append("cells", JSON.stringify(cells));
    form.append("formats", JSON.stringify(formats));
    form.append("name", name || cards[0].file.name);
    const res = await fetch("/api/runs", { method: "POST", body: form });
    const body = await res.json();
    if (!res.ok) return setErrors(body.errors ?? ["Could not start the run."]);
    setRun({ id: body.id, status: "running", steps: [], results: [] });
  }

  const loadPast = () =>
    fetch("/api/runs")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPast)
      .catch(() => {});

  useEffect(() => {
    loadPast();
  }, [run?.status]);

  useEffect(() => {
    if (!running || !run) return;
    poll.current = setInterval(async () => {
      const res = await fetch(`/api/runs/${run.id}`);
      if (res.ok) setRun(await res.json());
    }, 2000);
    return () => clearInterval(poll.current);
  }, [running, run?.id]);

  const failed = run?.steps.find((s) => s.status === "failed");

  return (
    <main>
      <h1>pullpage-bot</h1>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        style={{ border: "2px dashed #666", padding: 24, textAlign: "center" }}
      >
        Drop 1 to 3 cards here or{" "}
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>

      <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
        {cards.map((c, k) => (
          <div key={c.url}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.url} alt={c.file.name} width={120} />
            <div>
              <button onClick={() => setCards((p) => p.filter((_, i) => i !== k))}>Remove</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 28px)", gap: 2, marginTop: 6 }}>
              {Array.from({ length: 9 }, (_, i) => {
                const taken = cards.some((o, j) => j !== k && o.cell === i);
                return (
                  <button
                    key={i}
                    disabled={taken}
                    aria-pressed={c.cell === i}
                    onClick={() => setCards((p) => p.map((x, j) => (j === k ? { ...x, cell: i } : x)))}
                    style={{ height: 28, background: c.cell === i ? "#4a8" : undefined }}
                  >
                    {c.cell === i ? "x" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {(["binder", "toploader"] as const).map((f) => (
          <label key={f}>
            <input type="checkbox" checked={formats.includes(f)} onChange={() => toggleFormat(f)} /> {f}
          </label>
        ))}
        <input placeholder="run name" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!valid || running} onClick={start}>
          {failed || run?.status === "done" ? "Run again" : "Run"}
        </button>
      </div>

      {errors.map((e) => (
        <p key={e} style={{ color: "#f66" }}>{e}</p>
      ))}

      {run && (
        <ul>
          {run.steps.map((s) => (
            <li key={s.label}>
              {s.status === "done" ? "done" : s.status === "failed" ? "failed" : "..."} {s.label}
            </li>
          ))}
        </ul>
      )}
      {failed && <p style={{ color: "#f66" }}>Failed at {failed.error}</p>}

      {run?.status === "done" &&
        run.results.map((r) => (
          <div key={r.format}>
            <h3>{r.format}</h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/runs/${run.id}/image?format=${r.format}`} alt={r.format} style={{ maxWidth: 300 }} />
            <p>
              <a href={`/api/runs/${run.id}/image?format=${r.format}`} download>Download</a>{" · "}
              <a href={r.figmaUrl} target="_blank" rel="noreferrer">Open in Figma</a>{" · "}
              <Approve id={run.id} format={r.format} approved={false} onDone={loadPast} />
            </p>
          </div>
        ))}

      {past.length > 0 && (
        <section>
          <h2>Past runs</h2>
          {past.map((p) => (
            <div key={p.id} style={{ marginBottom: 16 }}>
              <strong>{p.name}</strong> <small>{new Date(p.createdAt).toLocaleString()}</small>
              <div style={{ display: "flex", gap: 16 }}>
                {p.formats.map((f) => (
                  <div key={f.format}>
                    <a href={`/api/runs/${p.id}/image?format=${f.format}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/runs/${p.id}/image?format=${f.format}`} alt={f.format} width={100} />
                    </a>
                    <div>{f.format}</div>
                    <Approve id={p.id} format={f.format} approved={f.approved} onDone={loadPast} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
