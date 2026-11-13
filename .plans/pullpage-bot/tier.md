# Tier

TIER: L
LOOP: phased
MODE: estimate
BASE: (file list)
FILES: 15
SOURCE: 9
LINES: (not measured)
CONFIG: none
DELIVERY: pr
ORCHESTRATOR: inherit high
BASE_BRANCH: auto
BRANCH_PREFIX: none
FIXTURE: .harness/

## Signals
- why: 9 source files
- sensitive: none
- user-visible: src/app/api/runs/route.ts, src/app/api/runs/[id]/route.ts, src/app/page.tsx
- tests: src/lib/geometry.test.ts, src/lib/imaging.test.ts, src/lib/engines/agy.test.ts, src/lib/engines/figma.test.ts, src/lib/pipeline.test.ts
- changed source files without a test: src/lib/geometry.ts, src/lib/imaging.ts, src/lib/engines/agy.ts, src/lib/engines/figma.ts, src/lib/pipeline.ts, src/lib/runs.ts, src/app/api/runs/route.ts, src/app/api/runs/[id]/route.ts, src/app/page.tsx
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
