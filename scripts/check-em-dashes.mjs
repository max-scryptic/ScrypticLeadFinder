#!/usr/bin/env node
// Scans the user-facing assets that the other two guards cannot reach: ESLint
// only parses TS/TSX, and the runtime guard only sees the DOM, so CSS generated
// content and text baked into static assets slip past both.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ROOTS = ["src", "public"];
const EXTENSIONS = new Set([
  ".css",
  ".html",
  ".json",
  ".md",
  ".svg",
  ".txt",
  ".webmanifest",
]);

// U+2014 EM DASH and U+2015 HORIZONTAL BAR.
const EM_DASH = /[—―]/;

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (EXTENSIONS.has(extname(entry.name))) yield path;
  }
}

const failures = [];

for (const root of ROOTS) {
  for await (const path of walk(join(repoRoot, root))) {
    const contents = await readFile(path, "utf8");
    contents.split("\n").forEach((line, index) => {
      if (EM_DASH.test(line)) {
        failures.push(`${relative(repoRoot, path)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error("Em dashes found in user-facing assets:\n");
  for (const failure of failures) console.error(`  ${failure}`);
  console.error("\nReplace them with a hyphen.");
  process.exit(1);
}

console.log("No em dashes found in user-facing assets.");
