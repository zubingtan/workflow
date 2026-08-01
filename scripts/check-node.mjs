/**
 * Pre-flight check: abort if the active Node is not v22.x.
 * Called at the start of dev/build/start scripts so a wrong nvm default
 * fails fast with a clear message instead of a cryptic ERR_DLOPEN_FAILED
 * from better-sqlite3 at runtime.
 */
const major = process.versions.node.split(".")[0];
if (major !== "22") {
  console.error(
    `\x1b[31m[check-node] Node 22 required, got v${process.versions.node}.\x1b[0m\n` +
      "Run: source ~/.nvm/nvm.sh && nvm use 22\n" +
      "Or use scripts/create-worktree.sh which enforces Node 22 automatically.",
  );
  process.exit(1);
}
