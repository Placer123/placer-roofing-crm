#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# No packages or build step: the PostgreSQL driver is vendored.
node --input-type=module -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw new Error("This project requires Node.js 22.5 or newer.");
  }
'

node --check server.js
while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find src public scripts test -type f -name '*.js' -print0)

# Workflow reconciliation restarts the server after this script succeeds.
# Do not seed data or run database-changing tests during merge setup.
echo "Post-merge setup complete: runtime and JavaScript syntax checked."
