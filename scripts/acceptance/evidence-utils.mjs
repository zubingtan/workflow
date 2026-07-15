import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const blockingTests = [
  "M0-T01", "M0-T02", "M0-T03", "M0-T04", "M0-T05", "M0-T06", "M0-T07",
  "M0-T07E", "M0-T08", "M0-T09", "M0-T10", "M0-T11", "M0-T12",
];

export function argument(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

export function requireArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function filesUnder(directory, current = directory) {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) return filesUnder(directory, absolute);
    return [path.relative(directory, absolute)];
  }).sort();
}

export function assertRegularFile(file, label = file) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Missing ${label}`);
}
