import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const known = existsSync(".env")
  ? readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => /^(TMDB_API_KEY|OMDB_API_KEY)=/.test(l))
      .map((l) => l.slice(l.indexOf("=") + 1).trim())
      .filter((v) => v.length >= 8 && !v.startsWith("your_"))
  : [];
let failures = [];
for (const file of files) {
  if (
    (/(^|\/)\.env($|\.)/.test(file) && !file.endsWith(".env.example")) ||
    /^\.vercel\//.test(file) ||
    /^\.cache\//.test(file)
  )
    failures.push(file + " (private configuration)");
  const body = execFileSync("git", ["show", ":" + file], {
    maxBuffer: 20 * 1024 * 1024,
  }).toString();
  if (known.some((secret) => body.includes(secret)))
    failures.push(file + " (local API key)");
  if (
    /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      body,
    )
  )
    failures.push(file + " (credential pattern)");
  if (
    /(?:TMDB_API_KEY|OMDB_API_KEY)\s*[:=]\s*["']?[a-f0-9]{8,32}\b/i.test(body)
  )
    failures.push(file + " (hardcoded provider key)");
}
if (failures.length) {
  console.error("Secret check failed:\n" + [...new Set(failures)].join("\n"));
  process.exit(1);
}
console.log(
  `Secret check passed: ${files.length} tracked files; no private config or detected credentials.`,
);
