# Tier

TIER: M
LOOP: micro
MODE: estimate
BASE: (file list)
FILES: 6
SOURCE: 4
LINES: (not measured)
CONFIG: none
DELIVERY: pr
ORCHESTRATOR: inherit high
BASE_BRANCH: wizard-revamp (user plan: main is init-only)
BRANCH_PREFIX: none
FIXTURE: .harness/

## Signals
- why: 4 source files, no sensitive path
- sensitive: none
- user-visible: none
- tests: src/lib/pipeline.test.ts, src/lib/engines/figma.test.ts
- changed source files without a test: src/lib/pipeline.ts, src/lib/engines/figma.ts, src/lib/engines/types.ts, src/lib/runs.ts
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
