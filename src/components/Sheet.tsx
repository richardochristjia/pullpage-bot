"use client";

import { useEffect, useRef, useState } from "react";
import { CANVAS, type Format } from "../lib/geometry";
import type { Dir } from "../lib/placement";
import type { Card } from "./SetupContext";

type Props = {
  format: Format;
  cards: Card[];
  onFiles: (files: File[], target?: number) => void;
  onMove: (i: number, target: number) => void;
  onNudge: (i: number, dir: Dir) => void;
  onRemove: (i: number) => void;
};

const KEYS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const cellAt = (x: number, y: number) => {
  const el = document.elementFromPoint(x, y)?.closest("[data-cell]") as HTMLElement | null;
  return el ? Number(el.dataset.cell) : null;
};

export default function Sheet({ format, cards, onFiles, onMove, onNudge, onRemove }: Props) {
  const { w, h } = CANVAS[format];
  const root = useRef<HTMLDivElement>(null);
  const focusIdx = useRef<number | null>(null);
  const drag = useRef<{ i: number; x: number; y: number; on: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ i: number; x: number; y: number } | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState<number | null>(null);

  // Cards remount when they change cell; give focus back to the one that was moved.
  useEffect(() => {
    if (focusIdx.current === null) return;
    root.current?.querySelector<HTMLElement>(`[data-card="${focusIdx.current}"]`)?.focus();
    focusIdx.current = null;
  }, [cards]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) { drag.current = null; setGhost(null); setOver(null); }
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const down = (e: React.PointerEvent, i: number) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { i, x: e.clientX, y: e.clientY, on: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.on = true;
    setGhost({ i: d.i, x: e.clientX, y: e.clientY });
    setOver(cellAt(e.clientX, e.clientY));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    setOver(null);
    if (!d) return;
    if (!d.on) return void (e.currentTarget as HTMLElement).focus();
    const t = cellAt(e.clientX, e.clientY);
    if (t !== null && t !== cards[d.i].cell) { focusIdx.current = d.i; onMove(d.i, t); }
  };
  const key = (e: React.KeyboardEvent, i: number) => {
    if (KEYS[e.key]) { e.preventDefault(); focusIdx.current = i; onNudge(i, KEYS[e.key]); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(i); }
  };

  return (
    <div className="sheet" ref={root} style={{ aspectRatio: `${w} / ${h}` }}>
      {Array.from({ length: 9 }, (_, n) => {
        const i = cards.findIndex((c) => c.cell === n);
        const c = cards[i];
        return (
          <div
            key={n}
            role="gridcell"
            data-cell={n}
            className={`cell${over === n || fileOver === n ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setFileOver(n); }}
            onDragLeave={() => setFileOver(null)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setFileOver(null); onFiles(Array.from(e.dataTransfer.files), n); }}
          >
            {c && (
              <div
                className="card"
                data-card={i}
                tabIndex={0}
                aria-label={`${c.file.name}, cell ${n + 1}`}
                onPointerDown={(e) => down(e, i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => { drag.current = null; setGhost(null); setOver(null); }}
                onKeyDown={(e) => key(e, i)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt="" draggable={false} />
                <span className="card-n">{i + 1}</span>
                <button type="button" className="card-x" aria-label={`Remove ${c.file.name}`} onClick={() => onRemove(i)}>×</button>
              </div>
            )}
          </div>
        );
      })}
      {ghost && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="ghost" src={cards[ghost.i].url} alt="" style={{ transform: `translate(${ghost.x + 8}px, ${ghost.y + 8}px)` }} />
      )}
    </div>
  );
}
