import { agyEngines } from "./engines/agy";
import { judge, publishCleanFrame, publishToFigma, runClaude } from "./engines/figma";
import type { Engines } from "./engines/types";
import type { Format } from "./geometry";
import { runPipeline, type RunInput, type StepStatus } from "./pipeline";

export type Run = {
  id: string;
  status: "running" | "done" | "failed";
  steps: { label: string; status: StepStatus; error?: string }[];
  results: { format: Format; figmaUrl: string }[];
};

// shortcut: in-memory, lost on restart; upgrade if runs must survive restarts.
type Store = { map: Map<string, Run>; active?: string };
const g = globalThis as unknown as { __runs?: Store };
const store: Store = (g.__runs ??= { map: new Map() });

export const getRun = (id: string) => store.map.get(id);
export const isBusy = () => store.active !== undefined;

export const defaultFigmaDeps = (fileKey: string) => ({ claude: (p: string) => runClaude(p), fetch, fileKey });

export const defaultEngines = (fileKey: string): Engines => ({
  ...agyEngines(),
  judge: (k, p, cwd) => judge(k, p, cwd),
  cleanFrame: (i) => publishCleanFrame(i, defaultFigmaDeps(fileKey)),
  figma: (i) => publishToFigma(i, defaultFigmaDeps(fileKey)),
});

export function startRun(input: RunInput, engines: Engines, root?: string) {
  const run: Run = { id: crypto.randomUUID(), status: "running", steps: [], results: [] };
  store.map.set(run.id, run);
  store.active = run.id;
  const onStep = (label: string, status: StepStatus, error?: string) => {
    const s = run.steps.find((x) => x.label === label);
    if (s) Object.assign(s, { status, error });
    else run.steps.push({ label, status, error });
  };
  runPipeline(run.id, input, engines, onStep, root)
    .then((r) => {
      run.results = r;
      run.status = "done";
    })
    .catch(() => (run.status = "failed"))
    .finally(() => (store.active = undefined));
  return run.id;
}
