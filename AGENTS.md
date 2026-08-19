<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# insurance-chat

Hebrew (RTL-only) AI chat for an insurance agent's customers. All user-facing text is in Hebrew.

**Current state, blockers, and the next task live in the brief** (the memory file), not here. This file holds only what is stable.

## Environment constraints

- **NetFree** filters TLS on this machine. Node requires `NODE_EXTRA_CA_CERTS=./certs/netfree-ca.pem` — already wired through `cross-env` in the npm scripts, **except `start`**. Side effect: the shadcn CLI is unusable; components are vendored by hand.
- **No python** on this machine (blocked by deny rules). For file processing: node + an npm package **inside the scratchpad, not in the project**.
- **`.env*` cannot be read or edited** (deny rules, plus `*.pem` / `*.key` / `*secret*` / `*credential*`). Diagnose env problems only through a node script that prints a key's **presence and length**, never its value. Adding keys is Lea's task, not the agent's.
- Windows 11 / PowerShell primary.

## Commands

```
npm run dev        # via .claude/launch.json ("insurance-chat" :3000, or "phase2" autoPort) — not manually
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build
npm run ingest     # scripts/ingest.ts — picks up *.pdf only
npm run eval       # scripts/eval/run-eval.ts — requires scripts/eval/golden-set.jsonl
```

**Run dev servers through `launch.json`**, not through Bash.

## Architectural boundaries

- **All** Surense access goes through `src/lib/surense.ts` only. No Surense calls anywhere else.
- The AI layer is centralized in `src/ai/` — `provider` / `embedder` / `system-prompt` / `retrieval` / `tools`.
- The ingest core is shared: `src/lib/ingest.ts` (used by both the CLI and the admin screen).
- `get_customer_data` **takes no ID parameter** — identity is injected from the session. Do not add one.
- **No personal data at rest.** A spec decision; any design that conflicts with it needs explicit approval.

## Version locks

- **AI SDK is pinned to v5.** npm will offer v7 — do not upgrade.
- Next 16.2 (not 15 as in the original spec).
- AI providers: `@ai-sdk/anthropic` / `openai` / `google` — the model is selected via env (`CHAT_MODEL`, `SUMMARY_MODEL`). **Currently running on Google**; Lea rejected OpenAI as not good enough in Hebrew.

## Hard prohibitions

- 🛑 **Never run `POST /swiftness/e9100/*`** or any pension-clearinghouse (מסלקה) operation. Vetoed by Racheli, the licensed agent — it is a regulated, billed action. Reading data already stored in Surense **is** allowed.
- 🛑 **Do not propose deprioritizing** the per-fund / per-policy data requirement. Lea rejected that suggestion explicitly.
- ⛔ Do not guess Surense OAuth scope names — a wrong scope breaks connection creation. The source of truth is the `requiredPermission` field in `GET /reports/providers`.

## Documentation — read only on demand

| File | When |
|---|---|
| `docs/characterization.md` | The approved spec, source of truth for the product |
| `docs/surense-integration.md` | Working on Surense/Make: scopes, endpoint map, probe protocol, what was already tried |
| `docs/decisions.md` | Answer policy, stack, budget, phasing, models |
| `docs/env-and-ops.md` | Something in the environment broke, or first ingest/eval run |

Do not open an archive that the current task does not touch — the split exists precisely to save that.

## Conventions

Talk to Lea in Hebrew. The `docs/` archives are written in Hebrew — keep them that way.

## Session wrap

At the end of a substantive work session: `/ic-wrap` — updates the brief and the archives.
