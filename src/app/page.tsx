"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Sheet from "../components/Sheet";
import { useSetup } from "../components/SetupContext";
import type { Format } from "../lib/geometry";
import { addAt, moveTo, nudge, removeAt } from "../lib/placement";

const MODES: { label: string; formats: Format[] }[] = [
  { label: "Binder", formats: ["binder"] },
  { label: "Toploader", formats: ["toploader"] },
  { label: "Both", formats: ["binder", "toploader"] },
];

// Server errors are flat strings; route each to the field it is about.
const fieldOf = (m: string) =>
  /Background prompt/.test(m) ? "bgPrompt" : /^Name/.test(m) ? "name" : /^Reference/.test(m) ? "bgRef"
  : /^Pick 1|cell|png, jpeg|larger than 25MB|share a cell/.test(m) ? "cards" : "form";

export default function SetupPage() {
  const router = useRouter();
  const { cards, setCards, formats, setFormats, name, setName, bgPrompt, setBgPrompt, bgRef, setBgRef, errors, setErrors } = useSetup();
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const cells = cards.map((c) => c.cell);
  const err = (k: string, m?: string) => setErrors((p) => { const n = { ...p }; if (m) n[k] = m; else delete n[k]; return n; });

  function addFiles(files: File[], target?: number) {
    const msgs: string[] = [];
    let cs = cells, next = [...cards], extra = 0;
    for (const file of files) {
      if (!file.type.startsWith("image/")) { msgs.push(`${file.name}: not an image`); continue; }
      const placed = addAt(cs, target);
      if (!placed) { extra++; continue; }
      cs = placed;
      next = next.map((c, i) => ({ ...c, cell: cs[i] }));
      next.push({ file, url: URL.createObjectURL(file), cell: cs[next.length] });
      target = undefined;
    }
    if (extra) msgs.push(`Only 3 cards fit; dropped ${extra} extra`);
    err("cards", msgs.join(". ") || undefined);
    if (next.length !== cards.length || next.some((c, i) => cards[i]?.cell !== c.cell)) setCards(next);
    if (next.length > cards.length) setLive(`${next.length} of 3 cards placed`);
  }

  const applyCells = (n: number[], msg: string) => {
    setCards((p) => p.map((c, i) => ({ ...c, cell: n[i] })));
    setLive(msg);
  };
  const remove = (i: number) => {
    URL.revokeObjectURL(cards[i].url);
    setCards((p) => p.filter((_, j) => j !== i));
    err("cards");
    setLive(`Card ${i + 1} removed`);
  };

  const addRef = useRef(addFiles);
  addRef.current = addFiles;
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      if (!(e.target as HTMLElement).closest?.("[data-ref]")) addRef.current(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, []);

  const setRef = (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return err("bgRef", `${file.name}: not an image`);
    err("bgRef");
    setBgRef((p) => (p && URL.revokeObjectURL(p.url), { file, url: URL.createObjectURL(file) }));
  };

  const mode = MODES.find((m) => m.formats.join() === formats.join()) ?? MODES[0];
  const n = cards.length + formats.length;
  const reason = !cards.length ? "Add 1 to 3 cards" : !formats.length ? "Pick a format" : "";

  async function start() {
    setErrors({});
    setActiveId(null);
    setBusy(true);
    const form = new FormData();
    cards.forEach((c) => form.append("cards", c.file));
    form.append("cells", JSON.stringify(cells));
    form.append("formats", JSON.stringify(formats));
    form.append("name", name || cards[0].file.name);
    if (bgPrompt.trim()) form.append("bgPrompt", bgPrompt);
    if (bgRef) form.append("bgRef", bgRef.file);
    try {
      const res = await fetch("/api/runs", { method: "POST", body: form });
      const body = await res.json();
      if (res.status === 202) return router.push(`/runs/${body.id}`);
      if (res.status === 409) setActiveId(body.activeId ?? "");
      else {
        const e: Record<string, string> = {};
        for (const m of (body.errors ?? ["Could not start the run."]) as string[]) { const k = fieldOf(m); e[k] = e[k] ? `${e[k]} ${m}` : m; }
        setErrors(e);
      }
    } catch {
      setErrors({ form: "Could not reach the server." });
    }
    setBusy(false);
  }

  return (
    <main className="wrap stack">
      <div className="page-head">
        <h1>New run</h1>
        <p className="meta"><b>{cards.length}</b> of 3 cards</p>
      </div>
      {activeId !== null && (
        <div className="banner" role="status">
          A run is already active.{" "}
          {activeId ? <Link href={`/runs/${activeId}`}>Open it</Link> : <Link href="/library">See Library</Link>}
        </div>
      )}
      <div className="setup">
        <section className="stack" aria-label="Sheet">
          <div className={`sheets${formats.length > 1 ? " two" : ""}`} role="grid" aria-label="3 by 3 sheet">
            {formats.map((f) => (
              <div key={f} className="stack">
                <span className="label">{f}</span>
                <Sheet format={f} cards={cards} onFiles={addFiles}
                  onMove={(i, t) => applyCells(moveTo(cells, i, t), `Card ${i + 1} to cell ${t + 1}`)}
                  onNudge={(i, d) => { const m = nudge(cells, i, d); applyCells(m, `Card ${i + 1} to cell ${m[i] + 1}`); }}
                  onRemove={remove} />
              </div>
            ))}
          </div>
          {!cards.length && <p className="hint">Drop 1 to 3 cards anywhere on the page, or onto a cell.</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => picker.current?.click()}>Add cards</button>
            <input ref={picker} type="file" hidden multiple accept="image/png,image/jpeg,image/webp"
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </div>
          {errors.cards && <p className="field-error" role="alert">{errors.cards}</p>}
          <div className="sr-only" aria-live="polite">{live}</div>
        </section>

        <section className="box stack" aria-label="Options">
          <h2>Options</h2>
          <div className="field">
            <span className="label" id="fmt">Format</span>
            <div className="seg" role="radiogroup" aria-labelledby="fmt">
              {MODES.map((m) => (
                <button key={m.label} type="button" role="radio" aria-checked={m === mode} onClick={() => setFormats(m.formats)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="name">Run name</label>
            <input id="name" className="input" value={name} placeholder={cards[0]?.file.name ?? "First card name"} onChange={(e) => setName(e.target.value)} />
            {errors.name && <p className="field-error">{errors.name}</p>}
          </div>
          <div className="field">
            <label htmlFor="prompt">Extra background prompt</label>
            <textarea id="prompt" className="input" rows={3} maxLength={1000} value={bgPrompt} onChange={(e) => setBgPrompt(e.target.value)} />
            {errors.bgPrompt && <p className="field-error">{errors.bgPrompt}</p>}
          </div>
          <div className="field">
            <span className="label" id="ref">Background reference</span>
            <div className="refbox" data-ref tabIndex={0} aria-labelledby="ref"
              onPaste={(e) => setRef(Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"))?.getAsFile())}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); setRef(Array.from(e.dataTransfer.files)[0]); }}>
              {bgRef ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bgRef.url} alt="Background reference" />
                  <button type="button" className="btn" onClick={() => setBgRef((p) => (p && URL.revokeObjectURL(p.url), null))}>Remove</button>
                </>
              ) : (
                <span className="hint">Click, then paste an image (Cmd+V), or drop one</span>
              )}
            </div>
            {errors.bgRef && <p className="field-error">{errors.bgRef}</p>}
          </div>
          <div className="runbar">
            {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
            <button type="button" className="btn btn-primary" disabled={!!reason || busy} onClick={start}>
              {busy ? "Uploading…" : "Run"}
            </button>
            <p className="meta">{reason || `about ${3 * n} min · ${n} agy calls`}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
