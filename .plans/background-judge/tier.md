# Tier

TIER: M
LOOP: micro
MODE: estimate
BASE: (file list)
FILES: 12
SOURCE: 7
LINES: (not measured)
CONFIG: none
DELIVERY: local (repo has no git remote)
ORCHESTRATOR: inherit high
BASE_BRANCH: link-cut-export (main is 50 commits behind the current code)
BRANCH_PREFIX: none
FIXTURE: .harness/

## Signals
- why: 7 source files, no sensitive path
- sensitive: none
- user-visible: src/app/page.tsx
- tests: src/lib/pipeline.test.ts, src/lib/engines/agy.test.ts, src/lib/engines/figma.test.ts, src/lib/imaging.test.ts
- changed source files without a test: src/lib/engines/types.ts, src/lib/engines/agy.ts, src/lib/engines/figma.ts, src/lib/runs.ts, src/lib/imaging.ts, src/lib/pipeline.ts, src/app/page.tsx
- substantial source files (10+ changed lines): none

## Steps
1. Build — sonnet
2. Context pack — sonnet
3. Correctness review (one angle) — sonnet
4. Falsify — sonnet
5. Fix, once — opus
6. Verify — sonnet
7. Push and merge-request link — sonnet
8. CI status — sonnet

## Skipped
- four-angle interrogate
- blast radius
- browser walkthrough
- simplify
- spec check
