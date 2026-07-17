import { readFileSync } from "node:fs";

const paths = [
  ...process.argv.slice(2),
  ...(process.stdin.isTTY ? [] : readFileSync(0, "utf8").split(/\r?\n/u)),
]
  .flatMap((value) => value.split(/\r?\n/u))
  .map((value) => value.trim().replace(/^\.\//u, ""))
  .filter(Boolean);

const rules = [
  ["release", /^(?:\.github\/workflows\/|\.githooks\/|scripts\/acceptance\/|(?:Dockerfile|compose\.yaml|pnpm-lock\.yaml)$)/u],
  ["e2e", /^(?:test\/e2e\/|playwright\.config\.ts$|(?:src\/)?app\/(?!api\/))/u],
  ["integration", /^(?:test\/(?:definition\/workflow-api|runtime\/run-api|failure\/terminal-failure).*\.test\.ts|(?:src\/)?(?:db|migrations|runtime|worker)\/)/u],
];
const commands = {
  fast: ["pnpm typecheck", "pnpm test:fast"],
  integration: ["pnpm typecheck", "pnpm test:fast", "pnpm test:integration"],
  e2e: ["pnpm typecheck", "pnpm test:fast", "pnpm test:integration", "pnpm test:e2e"],
  release: ["make verify-m0"],
};

const risk = rules.find(([, pattern]) => paths.some((path) => pattern.test(path)))?.[0] ?? "fast";
process.stdout.write(`${JSON.stringify({ risk, commands: commands[risk], paths }, null, 2)}\n`);
