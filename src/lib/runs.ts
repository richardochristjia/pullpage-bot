import { agyEngines } from "./engines/agy";
import { judge, publishCleanFrame, publishToFigma, runClaude } from "./engines/figma";
import type { Engines } from "./engines/types";
import type { Format } from "./geometry";
import { displayName, runPipeline, type RunInput, type StepStatus } from "./pipeline";
import { planSteps } from "./steps";

export type Step = { label: string; status: StepStatus; error?: string; image?: string; startedAt?: number; endedAt?: number };
export type Run = {
  id: string;
  status: "running" | "done" | "failed";
  steps: Step[];
  results: { format: Format; figmaUrl: string }[];
  name: string;
  cards: string[];
  formats: Format[];
  cells: number[];
  startedAt: number;
  error?: string;
};

// shortcut: in-memory, lost on restart; upgrade if runs must survive restarts.
type Store = { map: Map<string, Run>; active?: string };
const g = globalThis as unknown as { __runs?: Store };
const store: Store = (g.__runs ??= { map: new Map() });

export const getRun = (id: string) => store.map.get(id);
export const isBusy = () => store.active !== undefined;
export const activeRunId = () => store.active;

export const defaultFigmaDeps = (fileKey: string) => ({ claude: (p: string) => runClaude(p), fetch, fileKey });

export const defaultEngines = (fileKey: string): Engines => ({
  ...agyEngines(),
  judge: (k, p, cwd) => judge(k, p, cwd),
  cleanFrame: (i) => publishCleanFrame(i, defaultFigmaDeps(fileKey)),
  figma: (i) => publishToFigma(i, defaultFigmaDeps(fileKey)),
});

export function startRun(input: RunInput, engines: Engines, root?: string) {
  const run: Run = {
    id: crypto.randomUUID(),
    status: "running",
    steps: planSteps(input).map((label) => ({ label, status: "pending" })),
    results: [],
    name: displayName(input),
    cards: input.cards.map((c) => displayName({ ...input, name: undefined, cards: [c] })),
    formats: input.formats,
    cells: input.cells,
    startedAt: Date.now(),
  };
  store.map.set(run.id, run);
  store.active = run.id;
  const onStep = (label: string, status: StepStatus, error?: string, image?: string) => {
    let s = run.steps.find((x) => x.label === label);
    if (!s) run.steps.push((s = { label, status })); // unknown label: safe if the plan ever drifts
    s.status = status;
    s.error = error;
    if (image) s.image = image;
    if (status === "running") s.startedAt = Date.now();
    else if (status === "done" || status === "failed") s.endedAt = Date.now();
  };
  runPipeline(run.id, input, engines, onStep, root)
    .then((r) => {
      run.results = r;
      run.status = "done";
    })
    .catch((e) => {
      run.status = "failed";
      run.error = (e as Error).message;
      // check() has no catch, so a throw there would leave its row running.
      for (const s of run.steps)
        if (s.status === "running") Object.assign(s, { status: "failed", error: run.error, endedAt: Date.now() });
    })
    .finally(() => (store.active = undefined));
  return run.id;
}
