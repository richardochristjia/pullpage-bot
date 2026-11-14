# The Record

A curated list of factual, scoped statements asserting the application's **current** state. Authoritative for the present, never the future.

The planner consults this file before proposing a plan. If a feature **contradicts** an entry here, the contradiction is surfaced before the plan proceeds. If a feature **establishes a new high-level fact**, a verbatim entry is proposed for human approval as part of the plan. You may edit the RECORD, but only after presenting the changes to a human and getting human approval.

## Why This File Exists

A planner reads this file _instead of_ reading the code, so an entry earns its place only by being **expensive to re-derive** — a decision, a boundary, a user-visible behavior, or a fact whose only copy is scattered across several files.

If a reader could recover the fact from one grep or one file read, it does not belong here. Most things do not belong here. The list is expected to be short, and adding an entry is a claim that the fact is not already obvious from the code.

Deleting an entry is always safe; a planner that needs it will find it. A record that grows to mirror the codebase costs every future planner and goes stale within weeks.

## Format Rules

- **Factual.** Assert how things are _now_. Never future intent ("we will...", "should..."). Each entry is the current state of the application.
- **Durable.** Every entry must survive a routine change. Apply the **rename test**: if the codebase renamed this thing tomorrow — a config key, a crate, a type, an actor, an event, a schema version — would the entry be false? If yes, it is not a fact about the application; it is a fact about today's source tree. Delete it.
- **Scoped.** Name what each entry applies to — repo, app, frontend, or a named subsystem. An unscoped fact (e.g. "uses Fossil") is ambiguous: is that the repo, or the app's supported VCS list? Always disambiguate.
- **High-level.** One-liners (a few sentences at most). Capture decisions and facts a planner needs, not implementation minutiae.
- **Single tag.** Each entry carries exactly one subsystem tag as a `(tag)` prefix: `- (tools) The bash tool runs...`. One entry, one tag — this keeps tag usage a meaningful coverage metric (a tag growing large signals over-specification or a tag that should split). If you cannot decide between two tags for an entry, that is a signal to **re-evaluate the entry itself**, not to assign both. Use `(tag)` rather than `[tag]` to avoid colliding with markdown task-list (checkbox) syntax.
- **Tag subsystem scope.** It's not always obvious what tag to use for a given record entry. Pick based on existing tags or somewhat related subsystem. As particular tags start to become numerous, evaluate whether a new tag (subsystem) should be created based on the content of the tags. It's normal for subsystems to form after-the-fact so feel free to propose re-tagging of existing records.
- **Singular concept.** Each entry should be a single sentence and only concerned with a single concept. Prefer multiple entries versus combining many things into one.

## Templates

| Pattern     | Form                                                             | Example                                                                                             |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| State       | `[Scope] currently [does X / is Y].`                             | "(TUI) The TUI's first screen at startup is the chat screen."                                       |
| Persistence | `[Scope] persists [what] to [where].`                            | "(sessions) Sessions persist to SQLite."                                                            |
| Flow        | `[Input/event] is handled by [actor/subsystem], which [action].` | "(tools) File edits route through the `edit` tool, which requires a unique match or `replace_all`." |
| Boundary    | `[Scope] is bounded by [constraint].`                            | "(projects) Project discovery walks ancestors until a VCS root or `$HOME`, whichever comes first."  |

## Absence

A missing record, or an un-recorded area, simply means the list has no entry there yet. Absence is not a constraint — it is an open question, and a feature that fills a gap may establish the first entry for that area (proposed for human approval as part of the plan).

## Editing

Entries are added or amended **only with human approval**.

---

- (pipeline) A run takes one to three card images and produces one frame per selected format.
- (pipeline) Card images are resized to 750×1050 before any other step.
- (layout) The binder sleeve canvas is 2252×3152 with a 3×3 grid of 750×1050 cells separated by 1px.
- (layout) The toploader canvas is 2702×3602 with a 3×3 grid of 900×1200 cells, each holding a card inset by 75px.
- (clean) Card cleaning is handled by the Antigravity CLI on the user's Google AI subscription, which runs without API keys in its environment.
- (background) Background generation is handled by the Antigravity CLI on the user's Google AI subscription, and the result is upscaled to the canvas size.
- (figma) Frame assembly and export are handled by a headless Claude agent on Figma MCP, which writes to the `Automation` page of the configured Figma file.
- (output) Finished frames are persisted as PNG files to `pullpage-bot/output/`.
- (cut) Cutting a format builds its print pieces in Figma as clipping frames inside a cut frame beside the original frame, with the card layers left out.
- (cut) Making a PDF re-exports the format's cut frame and slices it at fixed piece positions, with no AI step.
- (cut) A PDF can be made only after its format has been cut to Figma.
- (cut) Binder cuts skip every cell that holds a card.
- (cut) Toploader cuts keep all nine 900×1200 cells, and card cells hold background only.
- (output) Approved cuts are persisted as one PDF per format, one 300 dpi page per piece in row-major order, to `pullpage-bot/output/<runId>/`.
- (output) Each finished run persists its name, card cells and Figma frame IDs to a metadata file in its output folder, so approval survives a restart.
- (clean) Cleaned cards and generated backgrounds are checked for text by macOS Vision OCR, and a step whose output still has text after one retry fails the run.
- (clean) Each run places its cleaned cards in a separate clean frame beside its run frames on the `Automation` page, outside the print path.
- (links) Pasted Figma frame links are cut one at a time, and each cut frame's link is added to the export list without being exported.
- (links) Link cuts read the format from the frame size and the card cells from the frame's card layers, with no run metadata.
- (links) Link exports read the format and card cells from the cut frame's size and pieces, and run only when a person clicks Export.
- (links) Frame links are accepted only from the configured Figma file.
- (output) Link exports persist one PDF per cut frame to `pullpage-bot/output/links/`.
- (clean) Card cleaning instructs agy to extend only the art window, keeping its colors, lighting, weather, time of day and object scale, with no new scenery.
- (clean) Each cleaned card is checked by a majority of three headless Claude votes for invented scenery, and a failing clean is regenerated once with the judge's problems in the prompt.
- (background) Each generated background is checked, with the original cards placed on it, by a majority of three headless Claude votes for scale breaks at the card edge, and a failing background is regenerated once with the judge's problems in the prompt.
- (pipeline) When a checked step still fails after its retry, the attempt with fewer flags is kept and the run finishes with that step marked as needing review.
- (background) A run can carry one optional extra prompt and one optional reference image, which every background fill in that run passes to agy after the fixed fill rules.
- (background) The background reference image is pasted or dropped into the run form, with no file picker.
- (ui) The run form places cards by dropping or dragging them onto a 3×3 sheet, where dropping on an occupied cell swaps the two cards.
- (ui) Each run has its own page at /runs/<runId>, which survives a page reload while the server keeps the run in memory.
- (pipeline) A run lists every planned step as pending when it starts, and each step records its start and end time.
- (api) Intermediate run images are served read-only from .work/<runId>/ for a fixed allow-list of file names.
- (ui) Past runs are listed at /library and the link cut and export tools sit at /links.
- (clean) Before cleaning, a run looks up each card by a hash of its uploaded bytes and the clean prompt, first in `.cache/clean/` and then in the `Automation` page's clean layers, and reuses a match without agy or the judges.
- (clean) Only cleans that pass the judges are cached locally and keyed in their Figma layer name, so a needs-review clean is regenerated on the next run.
- (clean) A failed Figma clean lookup falls back to cleaning and never fails the run.
