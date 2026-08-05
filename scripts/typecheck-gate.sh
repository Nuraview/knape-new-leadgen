#!/usr/bin/env bash
# Typecheck gate: fail when the error count RISES, not when it is non-zero.
#
# The vendored Kaneo tree carries a standing set of type errors (duplicated
# prosemirror copies, base-ui prop unions, better-auth role plugin typings).
# Fixing them is worth doing but is not this gate's job. A plain "must be zero"
# gate would be red on day one and would therefore be switched off, which is
# how you end up with no gate at all.
#
# So: count, compare against a committed baseline, fail if it grew. New broken
# code is blocked; the existing debt is visible and can be burned down by
# lowering the numbers below.
#
# Run it exactly as CI does:
#   ./scripts/typecheck-gate.sh
#
# IMPORTANT — how the counts are produced, because getting this wrong is how a
# crash shipped:
#   * apps/api  — `tsc --noEmit` reads apps/api/tsconfig.json, which includes
#     its sources. Correct as-is.
#   * apps/app  — the ROOT apps/app/tsconfig.json is a project-references stub
#     with "files": []. Running bare `tsc --noEmit` there compiles ZERO files
#     and cheerfully reports success. The real check needs
#     `-p tsconfig.app.json`, which is what `bun run typecheck` does.
#     A `useEffect is not defined` ReferenceError reached production because
#     the bare command was used by hand and reported "0 errors".
#   * apps/app's project also drags in ../api sources, so API errors would be
#     double-counted. They are filtered out here and counted once, by the API.
set -uo pipefail

cd "$(dirname "$0")/.."

# Lower these as the debt is paid off. Never raise them to make CI green.
BASELINE_API=28
BASELINE_APP=32

fail=0

api_errors=$(cd apps/api && bunx tsc --noEmit 2>&1 | grep -c 'error TS' || true)
app_errors=$(cd apps/app && bunx tsc --noEmit -p tsconfig.app.json 2>&1 \
  | grep 'error TS' | grep -vc '^\.\./api' || true)

printf 'apps/api: %s errors (baseline %s)\n' "$api_errors" "$BASELINE_API"
printf 'apps/app: %s errors (baseline %s)\n' "$app_errors" "$BASELINE_APP"

if [ "$api_errors" -gt "$BASELINE_API" ]; then
  echo "::error::apps/api type errors rose from ${BASELINE_API} to ${api_errors}"
  (cd apps/api && bunx tsc --noEmit 2>&1 | grep 'error TS' | head -40)
  fail=1
fi

if [ "$app_errors" -gt "$BASELINE_APP" ]; then
  echo "::error::apps/app type errors rose from ${BASELINE_APP} to ${app_errors}"
  (cd apps/app && bunx tsc --noEmit -p tsconfig.app.json 2>&1 \
    | grep 'error TS' | grep -v '^\.\./api' | head -40)
  fail=1
fi

if [ "$api_errors" -lt "$BASELINE_API" ] || [ "$app_errors" -lt "$BASELINE_APP" ]; then
  echo "Note: error count dropped. Lower the baselines in $0 to lock the gain in."
fi




# --- secret guard -------------------------------------------------------------
#
# A live Stripe restricted key was pasted into a terminal and landed as a
# FILENAME in the repo root — untracked, not ignored, and one `git add -A` away
# from being published to GitHub. `.gitignore` now covers it, but an ignore rule
# is a convention and this is a check.
#
# Scans tracked files AND the working tree for provider key prefixes. Deliberately
# matches the PREFIX only, never a full key, so this script can be read aloud.
echo "secret guard…"
# NOT `--exclude-standard`: .gitignore now covers these names, so honouring the
# ignore rules made this check blind to the exact file it exists to catch. Scan
# the working tree itself.
secret_hits=$(find . -maxdepth 3 -type f \
  \( -name '*sk_live*' -o -name '*rk_live*' -o -name '*whsec_*' \) \
  -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null || true)
if [ -n "$secret_hits" ]; then
  echo "::error::credential-looking FILE present:"
  echo "$secret_hits"
  fail=1
fi

# CONTENT of untracked files, not just their names.
#
# The name check above missed a file called `st.md` holding a live sk_live_
# secret key: innocuous name, untracked, so `git grep` (tracked only) could not
# see it either. It passed this gate clean. Matching on filenames alone is not a
# check — the dangerous file is the one that does not look dangerous.
untracked_secrets=$(git ls-files --others --exclude-standard 2>/dev/null \
  | while IFS= read -r f; do
      grep -lqE '(sk_live_|rk_live_|whsec_)[A-Za-z0-9]{20,}' "$f" 2>/dev/null && echo "$f"
    done)
if [ -n "$untracked_secrets" ]; then
  echo "::error::untracked file CONTAINS a live credential:"
  echo "$untracked_secrets"
  fail=1
fi
# Content, not just names — a key pasted into a source file.
if git grep -InE '(sk_live_|rk_live_)[A-Za-z0-9]{20,}' -- . >/dev/null 2>&1; then
  echo "::error::a live key literal is committed in tracked content"
  git grep -InE '(sk_live_|rk_live_)[A-Za-z0-9]{20,}' -- . | cut -c1-120 | head -5
  fail=1
fi

# --- raw-SQL column guard ---------------------------------------------------
#
# tsc cannot see inside a sql`` template, so a hand-written column name is
# invisible to every check until the query runs. This has now cost five
# production 500s: mkt_templates.body, mkt_users.name, crm_Leads.budget,
# whatsapp_outbox.jid, and crm_Proposal_Assets.url.
#
# This does not validate columns — that needs the database, and CI has none.
# It flags NEW raw SQL touching CRM tables so the author is reminded to check
# information_schema first, which is the step that keeps being skipped.
echo "raw-SQL review…"
new_sql=$(git diff --cached -U0 2>/dev/null | grep -E '^\+.*sql`.*(SELECT|INSERT|UPDATE)' | wc -l)
if [ "$new_sql" -gt 0 ]; then
  echo "  note: $new_sql new raw SQL statement(s) staged."
  echo "  Verify every column against information_schema before pushing —"
  echo "  tsc cannot, and this exact class has shipped five 500s."
fi

# --- import smoke test -------------------------------------------------------
#
# tsc resolves TYPES; it does not prove a module can be LOADED. A file importing
# a package that does not exist at runtime — `server-only`, a Next-only shim
# carried across in a port — typechecks clean and then crashes the API on boot.
# That exact import passed this gate, built two images, and was only caught by
# the deploy health check.
#
# Loading the route tree exercises every transitive import the server needs.
echo "import smoke test…"
if ! (cd apps/api && timeout 120 bunx tsx -e 'import("./src/marketing/index.ts").then(()=>import("./src/videos/cap-embed.ts")).then(()=>console.log("imports OK"))') ; then
  echo "::error::apps/api modules failed to load — a dependency is missing at runtime"
  fail=1
fi

exit "$fail"
