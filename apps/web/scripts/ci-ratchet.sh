#!/usr/bin/env bash
#
# Quality ratchet.
#
# The app ships with `typescript.ignoreBuildErrors: true` in next.config.js, so
# type errors accumulated invisibly for a long time. A hard `tsc --noEmit` gate
# would be red on day one and would simply be ignored, so instead we pin the
# current counts in .ci-baseline.json and fail only when they get WORSE.
#
# When you fix errors, lower the baseline in the same PR. When both counts hit
# zero, delete this script and turn on the real gates (and drop
# ignoreBuildErrors from next.config.js).
#
set -uo pipefail
cd "$(dirname "$0")/.."

BASELINE_FILE=".ci-baseline.json"
fail=0

read_baseline() {
  node -e "process.stdout.write(String(require('./$BASELINE_FILE').$1))"
}

echo "==> typecheck"
tsc_errors=$(npx tsc --noEmit 2>&1 | grep -c 'error TS' || true)
tsc_baseline=$(read_baseline tscErrors)
printf '    %s errors (baseline %s)\n' "$tsc_errors" "$tsc_baseline"
if [ "$tsc_errors" -gt "$tsc_baseline" ]; then
  echo "    FAIL: type errors increased by $((tsc_errors - tsc_baseline))."
  echo "    Fix them, or justify and raise the baseline deliberately."
  fail=1
elif [ "$tsc_errors" -lt "$tsc_baseline" ]; then
  echo "    Improved by $((tsc_baseline - tsc_errors)). Lower tscErrors to $tsc_errors in $BASELINE_FILE."
fi

echo "==> lint"
eslint_errors=$(npx eslint . -f json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(String(JSON.parse(s).reduce((n,f)=>n+f.errorCount,0)))}catch{process.stdout.write('-1')}})")
eslint_baseline=$(read_baseline eslintErrors)
printf '    %s errors (baseline %s)\n' "$eslint_errors" "$eslint_baseline"
if [ "$eslint_errors" -lt 0 ]; then
  echo "    FAIL: could not parse eslint output."
  fail=1
elif [ "$eslint_errors" -gt "$eslint_baseline" ]; then
  echo "    FAIL: lint errors increased by $((eslint_errors - eslint_baseline))."
  fail=1
elif [ "$eslint_errors" -lt "$eslint_baseline" ]; then
  echo "    Improved by $((eslint_baseline - eslint_errors)). Lower eslintErrors to $eslint_errors in $BASELINE_FILE."
fi

exit $fail
