---
name: ic-commit
description: Commit only the work done in this session, leaving every pre-existing uncommitted change in the working tree untouched, and write a focused title with a detailed explanatory body. Use this whenever Lea asks to commit "only the session's work", "just what we did", "רק השינויים מהסשן", or warns that the repo holds other uncommitted work — and reach for it unprompted before any commit in a tree that was already dirty when the session started, which on this repo is the normal state. It splits files holding both session and pre-existing edits hunk by hunk, so a shared file like package.json or docs/decisions.md can be committed without dragging in work that isn't ours.
---

# Committing only this session's work

## Why this needs a procedure

On this repo `master` is usually dirty. Lea keeps several threads of work in
flight at once, uncommitted, and a session that touches the same files sits on
top of hers. `git commit -a` or `git add .` would bundle her half-finished work
into our commit, which is both wrong and genuinely hard to undo once pushed.

Two things make this harder than it looks:

1. **Whole files are not the unit.** A session that changes one npm script
   touches a `package.json` that already had a dependency edit in it. The honest
   commit contains one of those hunks, not the file.
2. **Git cannot tell you whose change is whose.** It only knows the file is
   modified. The authorship information lives in *your* memory of what you
   edited this session, plus the git status snapshot taken when the session
   started. Both of those are yours to supply; the tooling can only act on them.

So the work is classification first, staging second. Get the classification
wrong and a clean-looking commit is still the wrong commit.

## Step 1 — establish the baseline

Find the `gitStatus` snapshot from the start of the session (the environment
context near the top of the conversation). Its Status list is the set of paths
that were **already dirty before we did anything**. Write the list down
explicitly before you touch the index — you will compare against it repeatedly,
and reconstructing it later from memory is how mistakes happen.

If that snapshot is missing, or the session has run long enough that you are no
longer sure what you edited, **ask Lea which files are hers** rather than
guessing. One question costs seconds; committing her work costs a revert and her
trust. Note also that the snapshot is a point in time — if other sessions have
been working in parallel, files may have appeared or changed since, and anything
you did not edit yourself is not yours regardless of what the snapshot says.

## Step 2 — classify every changed path

Run `git status --short` and sort each path into exactly one of three buckets:

- **Ours, whole.** Files the session created, and modified files absent from the
  baseline snapshot. These get `git add` as-is.
- **Shared.** Files in the baseline that the session also edited. These need
  hunk-level staging (Step 4).
- **Not ours.** Everything else — leave it alone entirely, staged or unstaged.

For shared files, `scripts/stage-hunks.mjs show <path>` prints the hunks
numbered, with only their added and removed lines, which is enough to recognise
your own edits. You wrote them this session, so you should be able to point at
them without hesitating. If a hunk is ambiguous, treat it as not ours and say so
in the report — under-committing is recoverable in one follow-up commit,
over-committing is not.

Two paths never get committed here regardless of bucket: anything matching
`.env*`, `*.pem`, `*.key`, `*secret*` or `*credential*` (the project's deny
rules exist for a reason), and `package-lock.json` unless the session itself
changed dependencies.

## Step 3 — branch if we are on the default branch

If `git branch --show-current` returns the default branch (`master` here), create
a branch before committing: `git checkout -b feat/<short-slug>`. The repo works
through pull requests — look at `git log --oneline -5` for the prefix convention
in use (`feat/`, `fix/`). Uncommitted work follows the branch switch, so Lea's
in-flight changes are unaffected and stay unstaged.

## Step 4 — stage

Whole files:

```bash
git add <path> <path> ...
```

Shared files, one at a time:

```bash
node .agents/skills/ic-commit/scripts/stage-hunks.mjs show <path>
node .agents/skills/ic-commit/scripts/stage-hunks.mjs stage <path> 1,3
```

(`.claude/skills/ic-commit/` is a link to that same directory, so either path
runs the same file — see `.agents/link-skills.mjs`.)

The script writes only to the index — it never modifies the working tree, so a
mistake costs nothing but a `reset` of that path. Do not reach for `git add -p`
(interactive, unusable here) or anything built on `git stash` (mutates the
working tree, and that tree holds work that isn't ours).

## Step 5 — verify before committing

This is the step that catches real mistakes, so do it every time even when you
are confident:

```bash
git diff --cached            # read it: is every hunk here ours?
git diff --stat              # the remainder: is everything else still intact?
```

Read the staged diff properly rather than skimming the stat line. You are
checking two different things: that nothing foreign got in, and that nothing of
Lea's disappeared from the working tree. If a shared file's staged diff shows a
hunk you do not recognise, unstage that file and redo it.

When the project has a typecheck or lint, run it before committing if the session
touched source files — a commit that does not compile is worse than a late one.

## Step 6 — write the message

The title is what Lea reads in `git log` a month from now; the body is what saves
her from re-deriving the reasoning. Both matter, and the body is where the detail
goes — never squeeze it into the title.

**Title**: conventional-commit prefix, then the specific change, under ~72
characters. Name the actual thing, not the category. `feat: add the agent's
pension articles to the RAG knowledge base`, not `feat: update knowledge base`.

**Body**: an opening paragraph saying what is now true, with the headline
numbers, then named groups of bullets for the distinct kinds of change, then a
verification line. Explain the *why* wherever a reader would otherwise wonder —
especially for anything that looks incidental, like a retry wrapper or a changed
npm flag, since those are exactly what gets reverted later by someone who does
not know why they were needed. Close with the attribution line the session's
instructions specify.

Shape it like this:

```
feat: add the agent's pension and savings articles to the RAG knowledge base

Ten new Hebrew knowledge documents under knowledge/, ingested as 30 chunks:
the professional content of nine newsletter articles, plus a five-page PDF.

Content handling
- Kept only the explanatory material; dropped marketing openers and prices.
- Removed every recipient name, per the "no personal data at rest" rule.

Environment fixes that ingest needed on this machine
- src/ai/embedder.ts: fetchWithRetry around the Voyage call. Behind NetFree's
  TLS filtering the first fetch from a cold node process dies on
  UND_ERR_CONNECT_TIMEOUT while the next one succeeds in 300ms.

Verified: 30 chunks across 11 documents, retrieval returns the right document
first. typecheck and lint pass.
```

Pass it through a heredoc so the formatting survives:

```bash
git commit -F - <<'EOF'
<message>
EOF
```

Write the message in English, matching the existing history, even though
everything said to Lea is in Hebrew.

## Step 7 — report in Hebrew

Tell her, in this order:

1. The branch and the short SHA.
2. What went in — grouped, not a bare file list.
3. **What was deliberately left out, by name.** This is the part she actually
   needs: she has to know her work is still sitting there unstaged and intact.
4. Anything you were unsure about and left behind for her to decide.

Do not push and do not open a PR unless she asks. Offer it as the next step.

## When it goes wrong

- **A patch refuses to apply.** The file changed since you read the diff,
  probably from a parallel session. Re-run `show` and pick the hunks again.
- **You staged something foreign.** `stage-hunks.mjs reset <path>` puts that
  path back; the working tree was never touched, so nothing is lost.
- **Already committed something foreign.** `git reset --soft HEAD~1` keeps every
  change in place and undoes only the commit, as long as it is not pushed. Tell
  Lea, fix the staging, commit again.
- **Nothing of ours turns out to be committable** (session was read-only, or
  everything already committed). Say so plainly instead of manufacturing a
  commit.
