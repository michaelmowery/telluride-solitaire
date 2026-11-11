#!/usr/bin/env bash
# Download the web-sized card photos from telluride.cards into assets/cards/.
# Run from the repo root on a machine that can reach telluride.cards:  ./scripts/fetch-cards.sh
# For the best look, replace these later with full-resolution exports named the same way
# (AS.jpg, 2S.jpg ... 10S.jpg, JS.jpg, QS.jpg, KS.jpg, same for H/D/C, plus back.jpg).
set -euo pipefail
BASE="https://telluride.cards/wp-content/uploads/2022/09"
OUT="$(dirname "$0")/../assets/cards"
mkdir -p "$OUT"
missing=()
for s in S H D C; do
  for r in A 2 3 4 5 6 7 8 9 10 J Q K; do
    code="$r$s"
    ok=""
    for name in "$code" "$code-1" "$code-2"; do   # WordPress sometimes appends -1 (e.g. QD-1.jpg)
      if curl -fsSL -o "$OUT/$code.jpg" "$BASE/$name.jpg"; then ok=1; break; fi
    done
    if [[ -n "$ok" ]]; then echo "ok   $code"; else rm -f "$OUT/$code.jpg"; missing+=("$code"); fi
  done
done
if ((${#missing[@]})); then
  echo "Not found on the site (the game shows a styled card for these): ${missing[*]}"
fi
