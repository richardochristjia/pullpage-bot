# Tier

TIER: L
LOOP: phased
MODE: estimate
BASE: (file list)
FILES: 12
SOURCE: 8
LINES: (not measured)
CONFIG: none
DELIVERY: pr
ORCHESTRATOR: inherit high
BASE_BRANCH: pullpage-bot (user: main has no app code)
BRANCH_PREFIX: none
FIXTURE: .harness/

## Signals
- why: declared by the user (measured M: 8 source files, no sensitive path)
- sensitive: none
- user-visible: src/app/api/runs/route.ts, src/app/api/runs/[id]/approve/route.ts, src/app/api/runs/[id]/pdf/route.ts, src/app/api/runs/[id]/image/route.ts, src/app/page.tsx
- tests: src/lib/pipeline.test.ts, src/lib/engines/figma.test.ts, src/lib/cut.test.ts
- changed source files without a test: src/lib/pipeline.ts, src/lib/engines/figma.ts, src/lib/cut.ts, src/app/api/runs/route.ts, src/app/api/runs/[id]/approve/route.ts, src/app/api/runs/[id]/pdf/route.ts, src/app/api/runs/[id]/image/route.ts, src/app/page.tsx
- substantial source files (10+ changed lines): none

## Steps
1. Build — sonnet
2. Context pack — sonnet
3. Review (four angles, blast radius) — sonnet
4. Falsify — sonnet
5. Fix, once — opus
6. Simplify and deslop — sonnet
7. Spec check — sonnet
8. Verify — sonnet
9. Push and merge-request link — sonnet
10. Browser walkthrough — sonnet
11. CI status — sonnet

## Skipped
- none
