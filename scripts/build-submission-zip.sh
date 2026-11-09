#!/usr/bin/env bash
# Builds the submission archive:  npm run submission:zip -- <path to the TDD (.pdf or .docx)> [--with-screenshots] [--check-only]
# It checks, in this order: the TDD file exists and ends in .pdf or .docx; deployment.md is in the repository root; deployment.md has no <LIVE_URL> or <REPO_URL> left
# (a failure; README.md only warns); the first 2,000 characters of the TDD text hold a github.com address and another https:// address (the live link). For a .docx the
# text comes from word/document.xml (Python's zipfile); for a .pdf from `pdftotext -l 1` when it exists. When the text cannot be read it prints MANUAL CHECK and goes on.
# Then it writes submission/township-submission-<YYYYMMDD-HHMM>.zip (Python's zipfile, not the zip command) holding EXACTLY the TDD file and deployment.md, plus docs/screenshots/
# with --with-screenshots (never by default), and prints the listing, the sizes and the SHA-256.
# --check-only runs the checks and writes nothing. It never changes the TDD, never reads .env and never uploads anything.
# Size: a warning above SUBMISSION_WARN_BYTES (default 10485760, 10 MB) and a failure above SUBMISSION_FAIL_BYTES (default 26214400, 25 MB); the real upload limit is
# UNKNOWN, 25 MB is an assumption. SUBMISSION_ROOT names the repository root when it is not found with git (tests use it).
# Exit codes: 0 ok, 1 a check failed, 2 wrong usage (no TDD file, another extension, no deployment.md).
set -u

tdd=""
with_screenshots=0
check_only=0
for arg in "$@"; do
  case "$arg" in
    --with-screenshots) with_screenshots=1 ;;
    --check-only) check_only=1 ;;
    -*) echo "unknown option: $arg"; exit 2 ;;
    *) tdd="$arg" ;;
  esac
done

if [ -z "$tdd" ] || [ ! -f "$tdd" ]; then
  echo "usage: npm run submission:zip -- <path to the TDD file (.pdf or .docx)> [--with-screenshots]"
  echo "the TDD file was not found: ${tdd:-"(none given)"}"
  exit 2
fi
case "$tdd" in
  *.pdf | *.docx) ;;
  *) echo "the TDD file must end in .pdf or .docx: $tdd"; exit 2 ;;
esac
tdd_abs="$(cd "$(dirname "$tdd")" && pwd)/$(basename "$tdd")"

root="${SUBMISSION_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [ -z "$root" ] || [ ! -d "$root" ]; then
  echo "cannot find the repository root: run this inside the repository"
  exit 2
fi
echo "repository root: $root"
if [ ! -f "$root/deployment.md" ]; then
  echo "deployment.md is not in the repository root: $root"
  exit 2
fi

failed=0
placeholder_hits="$(grep -n '<LIVE_URL>\|<REPO_URL>' "$root/deployment.md" || true)"
if [ -n "$placeholder_hits" ]; then
  echo "FAIL: deployment.md still has a placeholder:"
  echo "$placeholder_hits" | sed 's/^/  deployment.md:/' | cut -c1-160
  failed=1
fi
if [ -f "$root/README.md" ]; then
  readme_hits="$(grep -n '<LIVE_URL>\|<REPO_URL>' "$root/README.md" || true)"
  if [ -n "$readme_hits" ]; then
    echo "WARN: README.md still has a placeholder (not a failure):"
    echo "$readme_hits" | sed 's/^/  README.md:/' | cut -c1-160
  fi
fi

# The first 2,000 characters of the TDD text, or nothing when it cannot be read.
text=""
extracted=0
case "$tdd_abs" in
  *.docx)
    if command -v python3 >/dev/null 2>&1; then
      if text="$(python3 - "$tdd_abs" <<'PY'
import re, sys, zipfile, html
with zipfile.ZipFile(sys.argv[1]) as z:
    xml = z.read("word/document.xml").decode("utf-8", "replace")
xml = re.sub(r"</w:p>", "\n", xml)
print(html.unescape(re.sub(r"<[^>]+>", "", xml))[:2000])
PY
      )"; then extracted=1; fi
    fi
    ;;
  *.pdf)
    if command -v pdftotext >/dev/null 2>&1; then
      if text="$(pdftotext -l 1 "$tdd_abs" - 2>/dev/null)" && [ -n "$text" ]; then
        text="$(printf '%s' "$text" | head -c 2000)"
        extracted=1
      fi
    fi
    ;;
esac
if [ "$extracted" = 1 ]; then
  printf '%s' "$text" | grep -Eq 'github\.com' || { echo "FAIL: no github.com address in the first 2,000 characters of the TDD"; failed=1; }
  printf '%s' "$text" | grep -Eo 'https://[^[:space:])>"]+' | grep -v 'github\.com' | grep -q . || { echo "FAIL: no live link (an https:// address other than GitHub) in the first 2,000 characters of the TDD"; failed=1; }
else
  echo "MANUAL CHECK: confirm the GitHub URL and the live link are at the very top of the TDD"
fi

if [ "$failed" = 1 ]; then
  echo "nothing was written."
  exit 1
fi
if [ "$check_only" = 1 ]; then
  echo "checks passed (--check-only: no archive written)"
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M)"
out_dir="$root/submission"
mkdir -p "$out_dir"
out="$out_dir/township-submission-$stamp.zip"
python3 - "$out" "$tdd_abs" "$root" "$with_screenshots" "${SUBMISSION_WARN_BYTES:-10485760}" "${SUBMISSION_FAIL_BYTES:-26214400}" <<'PY'
import hashlib, os, sys, zipfile
out, tdd, root, with_screenshots, warn, fail = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "1", int(sys.argv[5]), int(sys.argv[6])
entries = [(os.path.basename(tdd), tdd), ("deployment.md", os.path.join(root, "deployment.md"))]
if with_screenshots:
    shots = os.path.join(root, "docs", "screenshots")
    for folder, _dirs, files in sorted(os.walk(shots)):
        for name in sorted(files):
            full = os.path.join(folder, name)
            entries.append((os.path.relpath(full, root).replace(os.sep, "/"), full))
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for arcname, full in entries:
        z.write(full, arcname)
size = os.path.getsize(out)
print("archive: " + os.path.relpath(out, root))
with zipfile.ZipFile(out) as z:
    for info in z.infolist():
        print(f"  {info.file_size:>10}  {info.filename}")
digest = hashlib.sha256(open(out, "rb").read()).hexdigest()
print(f"size: {size} bytes ({size / 1048576:.2f} MB)")
print(f"sha256: {digest}")
if size > fail:
    os.remove(out)
    print(f"FAIL: the archive is over {fail} bytes; it was removed (the real upload limit is unknown: this limit is an assumption)")
    sys.exit(1)
if size > warn:
    print(f"WARN: the archive is over {warn} bytes (the real upload limit is unknown)")
PY
