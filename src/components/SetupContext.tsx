"use client";

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Format } from "../lib/geometry";

export type Card = { file: File; url: string; cell: number };
export type BgRef = { file: File; url: string };

type Setup = {
  cards: Card[]; setCards: Dispatch<SetStateAction<Card[]>>;
  formats: Format[]; setFormats: Dispatch<SetStateAction<Format[]>>;
  name: string; setName: (v: string) => void;
  bgPrompt: string; setBgPrompt: (v: string) => void;
  bgRef: BgRef | null; setBgRef: Dispatch<SetStateAction<BgRef | null>>;
  errors: Record<string, string>; setErrors: Dispatch<SetStateAction<Record<string, string>>>;
};

const Ctx = createContext<Setup | null>(null);

// Lives in the layout so "Run again" keeps the inputs; a reload drops them.
export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [formats, setFormats] = useState<Format[]>(["binder"]);
  const [name, setName] = useState("");
  const [bgPrompt, setBgPrompt] = useState("");
  const [bgRef, setBgRef] = useState<BgRef | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const urls = useRef<string[]>([]);
  urls.current = [...cards.map((c) => c.url), ...(bgRef ? [bgRef.url] : [])];
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const value = { cards, setCards, formats, setFormats, name, setName, bgPrompt, setBgPrompt, bgRef, setBgRef, errors, setErrors };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSetup() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSetup outside SetupProvider");
  return v;
}
