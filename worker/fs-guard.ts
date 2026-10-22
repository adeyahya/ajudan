/**
 * Path checks shared by the teammate tools: is a path really inside the teammate's
 * folder once symlinks are followed? (A symlink in the folder pointing at ~/.ssh
 * must not pass as "inside".)
 */
import fs from "node:fs";
import path from "node:path";

/** realpath of the deepest existing ancestor, so symlinks can't escape and new files resolve. */
export function resolveReal(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return p;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return path.join(fs.realpathSync(cur), ...rest);
}

export function isInside(p: string, dir: string) {
  return p === dir || p.startsWith(dir + path.sep);
}

/**
 * Resolves `file` (as a teammate wrote it) against `cwd` and returns its real path
 * when it is an existing regular file inside the real `cwd`; null otherwise.
 */
export function fileInside(cwd: string, file: string): string | null {
  const realCwd = fs.realpathSync(cwd);
  const real = resolveReal(path.resolve(realCwd, file));
  if (!isInside(real, realCwd)) return null;
  try {
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}
