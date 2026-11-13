# Tier

TIER: L
LOOP: phased
MODE: estimate
BASE: (file list)
FILES: 14
SOURCE: 10
LINES: (not measured)
CONFIG: none
DELIVERY: pr
ORCHESTRATOR: inherit high
BASE_BRANCH: auto
BRANCH_PREFIX: none
FIXTURE: .harness/

## Signals
- why: 10 source files
- sensitive: none
- user-visible: src/app/api/links/cut/route.ts, src/app/api/links/export/route.ts, src/app/api/links/pdf/route.ts, src/app/page.tsx
- tests: src/lib/links.test.ts, src/lib/engines/figma.test.ts, src/lib/pipeline.test.ts
- changed source files without a test: src/lib/links.ts, src/lib/engines/figma.ts, src/lib/engines/types.ts, src/lib/pipeline.ts, src/lib/runs.ts, src/lib/approve.ts, src/app/api/links/cut/route.ts, src/app/api/links/export/route.ts, src/app/api/links/pdf/route.ts, src/app/page.tsx
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
