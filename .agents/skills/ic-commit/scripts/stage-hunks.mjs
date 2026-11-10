#!/usr/bin/env node
/**
 * stage-hunks.mjs — put individual hunks of a modified file into the git index.
 *
 * Why this exists: `git add -p` is interactive and unusable from an agent
 * session, and anything built on `git stash` mutates the working tree, which
 * risks losing uncommitted work that isn't ours. This builds a patch holding
 * only the chosen hunks, rebases their line numbers as if the skipped hunks
 * were never there, and applies it with `git apply --cached`. The index
 * changes; the working tree is never written to.
 *
 * Commands:
 *   node stage-hunks.mjs list                changed tracked files, one per line
 *   node stage-hunks.mjs show <path>         hunks of one file, numbered
 *   node stage-hunks.mjs stage <path> 1,3    stage only hunks 1 and 3
 *   node stage-hunks.mjs reset <path>        unstage that file again
 *
 * `show` prints each hunk's header and only its +/- lines, not the context
 * lines — that is what tells one hunk from another, and it keeps the output
 * small enough to read in full. Use `git diff -- <path>` when you need the
 * surrounding context too.
 */
import { execFileSync } from "node:child_process";

const git = (args, opts = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: root,
    ...opts,
  });

let root;
try {
  root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
} catch {
  fail("not inside a git repository");
}

function fail(message) {
  console.error(`stage-hunks: ${message}`);
  process.exit(1);
}

/** Split a unified diff into its header lines and its hunks. */
function parseDiff(text) {
  const lines = text.split("\n");
  const firstHunk = lines.findIndex((l) => l.startsWith("@@"));
  if (firstHunk === -1) return { header: lines, hunks: [] };
  const hunks = [];
  for (let i = firstHunk; i < lines.length; i++) {
    if (lines[i].startsWith("@@")) hunks.push({ head: lines[i], body: [] });
    else hunks[hunks.length - 1].body.push(lines[i]);
  }
  // git ends the diff with a trailing newline, which shows up as a final "" line
  const last = hunks[hunks.length - 1];
  if (last && last.body[last.body.length - 1] === "") last.body.pop();
  return { header: lines.slice(0, firstHunk), hunks };
}

function diffOf(path) {
  const text = git(["diff", "--", path]);
  if (!text.trim()) {
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", path]).trim();
    if (untracked) fail(`${path} is untracked — stage it whole with \`git add\``);
    fail(`${path} has no unstaged changes`);
  }
  const parsed = parseDiff(text);
  if (parsed.hunks.length === 0) fail(`${path} has no text hunks (binary file or mode change only?)`);
  return parsed;
}

function warnIfAlreadyStaged(path) {
  if (git(["diff", "--cached", "--name-only", "--", path]).trim()) {
    console.error(
      `stage-hunks: warning — ${path} already has staged changes, so hunk numbers\n` +
        "  below are relative to the index, not to HEAD. Consider `reset` first.",
    );
  }
}

function parseHead(head) {
  const m = head.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
  if (!m) fail(`unparsable hunk header: ${head}`);
  return {
    oldStart: Number(m[1]),
    oldCount: m[2] === undefined ? 1 : Number(m[2]),
    newCount: m[4] === undefined ? 1 : Number(m[4]),
    trailer: m[5],
  };
}

const [command, path, indices] = process.argv.slice(2);

if (command === "list") {
  const names = git(["diff", "--name-only", "-z"]).split("\0").filter(Boolean);
  if (names.length === 0) console.log("(no unstaged changes to tracked files)");
  for (const n of names) console.log(n);
  process.exit(0);
}

if (!path) fail(`usage: stage-hunks.mjs <list|show|stage|reset> [path] [hunk,numbers]`);

if (command === "reset") {
  git(["restore", "--staged", "--", path], { stdio: "inherit" });
  console.log(`unstaged ${path}`);
  process.exit(0);
}

if (command === "show") {
  warnIfAlreadyStaged(path);
  const { hunks } = diffOf(path);
  console.log(`${path} — ${hunks.length} hunk(s)\n`);
  for (const [i, hunk] of hunks.entries()) {
    const { oldStart, oldCount } = parseHead(hunk.head);
    const changed = hunk.body.filter((l) => l.startsWith("+") || l.startsWith("-"));
    console.log(`── hunk ${i + 1}  (around line ${oldStart}, ${oldCount} line(s) of context)`);
    for (const l of changed) console.log(`   ${l}`);
    console.log("");
  }
  process.exit(0);
}

if (command === "stage") {
  if (!indices) fail("stage needs the hunk numbers, e.g. `stage src/x.ts 1,3`");
  const wanted = new Set(
    indices.split(",").map((s) => {
      const n = Number(s.trim());
      if (!Number.isInteger(n) || n < 1) fail(`bad hunk number: ${s}`);
      return n;
    }),
  );
  warnIfAlreadyStaged(path);
  const { header, hunks } = diffOf(path);
  for (const n of wanted) {
    if (n > hunks.length) fail(`${path} has only ${hunks.length} hunk(s), you asked for ${n}`);
  }

  const out = [...header];
  let delta = 0; // line shift contributed by the hunks we keep
  for (const [i, hunk] of hunks.entries()) {
    const { oldStart, oldCount, newCount, trailer } = parseHead(hunk.head);
    if (!wanted.has(i + 1)) continue;
    out.push(`@@ -${oldStart},${oldCount} +${oldStart + delta},${newCount} @@${trailer}`);
    out.push(...hunk.body);
    delta += newCount - oldCount;
  }
  const patch = out.join("\n") + "\n";

  try {
    git(["apply", "--cached", "--check", "-"], { input: patch });
  } catch (err) {
    fail(
      `the patch for ${path} does not apply to the index — the file changed under us.\n` +
        `  Re-run \`show\` and pick the hunks again.\n  ${String(err.stderr ?? err.message).trim()}`,
    );
  }
  git(["apply", "--cached", "-"], { input: patch });
  console.log(`staged ${wanted.size} of ${hunks.length} hunk(s) in ${path}`);
  process.exit(0);
}

fail(`unknown command: ${command ?? "(none)"}`);
