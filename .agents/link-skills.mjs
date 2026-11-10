#!/usr/bin/env node
/**
 * link-skills.mjs — mirror .agents/skills/ into .claude/skills/.
 *
 * Why this exists: SKILL.md is a standard format (agentskills.io) but the
 * directory it lives in is not. Codex scans `.agents/skills` from the working
 * directory up to the repository root; Claude Code reads only `.claude/skills`.
 * So the skills are authored once under `.agents/skills/` — the neutral,
 * checked-in source of truth — and this script points `.claude/skills/` at them.
 *
 * It creates links, never copies, so the two paths can never drift apart.
 * On Windows it uses directory junctions, which need no administrator rights
 * and no Developer Mode; elsewhere it uses ordinary directory symlinks. Git
 * cannot record either one on this machine (core.symlinks is false), which is
 * why `.claude/skills/` is gitignored and this script is the setup step after
 * a fresh clone.
 *
 * Run it after cloning, and after adding or renaming a skill:
 *   node .agents/link-skills.mjs
 *   node .agents/link-skills.mjs --check   # report only, change nothing
 *
 * Safety: an existing real directory under .claude/skills/ is never deleted.
 * If one is in the way the script reports it and leaves it alone, because that
 * directory may be the only copy of a skill someone wrote in the old location.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const checkOnly = process.argv.includes("--check");

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const source = path.join(root, ".agents", "skills");
const mirror = path.join(root, ".claude", "skills");
const linkType = process.platform === "win32" ? "junction" : "dir";

if (!existsSync(source)) {
  console.error(`link-skills: ${path.relative(root, source)} does not exist — nothing to mirror`);
  process.exit(1);
}

const skills = readdirSync(source, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(source, e.name, "SKILL.md")))
  .map((e) => e.name);

if (skills.length === 0) {
  console.log("link-skills: no skills found (a skill is a directory holding a SKILL.md)");
  process.exit(0);
}

if (!existsSync(mirror) && !checkOnly) mkdirSync(mirror, { recursive: true });

/** Resolve what a link points at, or null when the path is not a link. */
function linkTarget(p) {
  try {
    if (!lstatSync(p).isSymbolicLink()) return null;
    return path.resolve(path.dirname(p), readlinkSync(p));
  } catch {
    return null;
  }
}

let created = 0;
let blocked = 0;
const problems = [];

for (const name of skills) {
  const target = path.join(source, name);
  const link = path.join(mirror, name);
  const shown = path.relative(root, link).replace(/\\/g, "/");

  if (existsSync(link) || linkTarget(link)) {
    const current = linkTarget(link);
    if (current === null) {
      // A real directory or file sits here. It may hold someone's only copy.
      problems.push(`${shown} is a real directory, not a link — move it into .agents/skills/ and rerun`);
      blocked++;
      continue;
    }
    if (current === target) {
      console.log(`ok       ${shown}`);
      continue;
    }
    if (checkOnly) {
      console.log(`relink   ${shown} (points at ${path.relative(root, current)})`);
      created++;
      continue;
    }
    rmSync(link, { recursive: false, force: true }); // only ever a link by now
  }

  if (checkOnly) {
    console.log(`missing  ${shown}`);
    created++;
    continue;
  }

  symlinkSync(target, link, linkType);
  console.log(`linked   ${shown} -> ${path.relative(mirror, target).replace(/\\/g, "/")}`);
  created++;
}

const verb = checkOnly ? "would change" : "linked";
console.log(`\n${skills.length} skill(s) in .agents/skills/, ${created} ${verb}, ${blocked} blocked`);

if (blocked > 0) {
  for (const p of problems) console.error(`link-skills: ${p}`);
  process.exit(1);
}
if (checkOnly && created > 0) process.exit(1);
