import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { filesUnder, requireArgument, sha256File } from "./evidence-utils.mjs";

const bundle = requireArgument("--evidence-dir");
const manifestPath = path.join(bundle, "MANIFEST");
const checksumsPath = path.join(bundle, "SHA256SUMS");
if (existsSync(manifestPath) || existsSync(checksumsPath)) throw new Error("Evidence bundle is already sealed");

const files = filesUnder(bundle).filter((file) => !["MANIFEST", "SHA256SUMS"].includes(file));
writeFileSync(manifestPath, `${JSON.stringify({ files }, null, 2)}\n`);
writeFileSync(checksumsPath, [...files, "MANIFEST"]
  .map((file) => `${sha256File(path.join(bundle, file))}  ${file}`)
  .join("\n") + "\n");
console.log(`Sealed ${files.length} evidence files`);
