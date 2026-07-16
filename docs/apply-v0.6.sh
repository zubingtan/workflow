#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-./docs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$(cd "$(dirname "$TARGET_DIR")" 2>/dev/null && pwd || pwd)"
BACKUP_FILE="${BACKUP_DIR}/pi-agent-oncall-docs-backup-${TIMESTAMP}.tar.gz"

mkdir -p "$TARGET_DIR"

FILES=(
  README.md
  01-PRD.md
  02-DESIGN-DOC.md
  03-ADR.md
  04-ROADMAP.md
  05-DOCUMENTATION-GOVERNANCE.md
  06-MEMORY-DESIGN.md
  07-WORKFLOW-TESTING-UX.md
  08-FEASIBILITY-ANALYSIS.md
  09-MILESTONE-AUTOMATED-ACCEPTANCE.md
  10-VISUAL-WORKFLOW-ARCHITECTURE.md
  11-COZE-FLOWGRAM-REFERENCE.md
  12-REVIEW-AND-OPEN-QUESTIONS.md
  CHANGELOG-v0.6.md
  CODE-CONFORMANCE-REPORT.md
  CODEX-NEXT-INSTRUCTION.md
  VALIDATION-REPORT.md
  MANIFEST.json
  SHA256SUMS
  apply-v0.6.sh
)

EXISTING=()
for file in "${FILES[@]}" CHANGELOG-v0.4.md CHANGELOG-v0.5.md; do
  if [[ -f "$TARGET_DIR/$file" ]]; then
    EXISTING+=("$file")
  fi
done

if (( ${#EXISTING[@]} > 0 )); then
  tar -czf "$BACKUP_FILE" -C "$TARGET_DIR" "${EXISTING[@]}"
  echo "Backup created: $BACKUP_FILE"
fi

rm -f "$TARGET_DIR/CHANGELOG-v0.4.md" "$TARGET_DIR/CHANGELOG-v0.5.md"

for file in "${FILES[@]}"; do
  cp "$SOURCE_DIR/$file" "$TARGET_DIR/$file"
done

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$TARGET_DIR" && sha256sum -c SHA256SUMS)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$TARGET_DIR" && shasum -a 256 -c SHA256SUMS)
else
  echo "Warning: no SHA256 verification command found."
fi

echo "Installed pi-agent oncall documentation v0.6 revised baseline into: $TARGET_DIR"
