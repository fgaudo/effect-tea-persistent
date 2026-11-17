// Moves notes into `docs/decisions/archive/` by `git mv`, then rewrites every relative link of the repository's `.md`
// files that points at a moved note, and every relative link inside a moved note, so that each resolves from where
// its file now lies. Run as `bun scripts/archive-notes.ts 0248 0249`, then `bun run links`. The step The rules move
// from the notes into documents kept true, of the roadmap, moves the notes of an area with it (decision 0294).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

const root = resolve(join(import.meta.dir, ".."));
const numbers = process.argv.slice(2);
if (numbers.length === 0 || numbers.some((number) => !/^\d{4}$/.test(number))) {
  throw new Error("usage: bun scripts/archive-notes.ts <number of four digits>...");
}
const toPosix = (path: string) => path.split(sep).join("/");
const decisions = "docs/decisions";
const archive = `${decisions}/archive`;

const names = readdirSync(join(root, decisions))
  .filter((name) => numbers.some((number) => name.startsWith(`${number}-`)));
const missing = numbers.filter((number) => !names.some((name) => name.startsWith(`${number}-`)));
if (missing.length > 0) throw new Error(`no note outside the archive is numbered ${missing.join(", ")}`);
for (const name of names) {
  const moved = Bun.spawnSync(["git", "mv", `${decisions}/${name}`, `${archive}/${name}`], { cwd: root });
  if (moved.exitCode !== 0) throw new Error(`git mv of ${name} failed: ${moved.stderr.toString()}`);
}

// A path before the move, relative to the root, and the path after it.
const movedTo = new Map(names.map((name) => [`${decisions}/${name}`, `${archive}/${name}`]));
const movedFrom = new Map([...movedTo].map(([before, after]) => [after, before]));

const files = readdirSync(root, { recursive: true, encoding: "utf8" })
  .map(toPosix)
  .filter((file) => file.endsWith(".md") && !/(^|\/)(node_modules|\.git|\.build)\//.test(file));

for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  // A moved note's links were written from where it lay before the move.
  const wroteFrom = movedFrom.get(file) ?? file;
  const rewritten = text.replace(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g, (link: string, target: string, hash: string = "") => {
    if (/^[a-z]+:/i.test(target)) return link;
    const before = posix.normalize(posix.join(posix.dirname(wroteFrom), target));
    const after = movedTo.get(before) ?? before;
    if (after === before && wroteFrom === file) return link;
    let path = toPosix(relative(dirname(join(root, file)), join(root, after))) || ".";
    if (target.endsWith("/") && !path.endsWith("/")) path += "/";
    return `](${path}${hash})`;
  });
  if (rewritten !== text) {
    writeFileSync(join(root, file), rewritten);
    console.log(file);
  }
}
