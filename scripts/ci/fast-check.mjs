import { spawnSync } from "node:child_process";

const commands = [
  ["node", ["--test", "test/bootstrap/doctor-contract.test.mjs", "test/bootstrap/health-contract.test.mjs", "test/runtime/runtime-contract.test.mjs"]],
  ["pnpm", ["test:definition:contract"]],
  ["pnpm", ["test:failure:unit"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
