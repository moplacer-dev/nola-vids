#!/usr/bin/env bash
# Smoke test for v2 lessons endpoint. Run against a local server.
# Usage: ./scripts/smoke_v2_push.sh
#        BASE=http://localhost:9999 ./scripts/smoke_v2_push.sh
set -euo pipefail

ACCESS_KEY=$(grep -E '^ACCESS_KEY=' .env | cut -d= -f2-)
BASE=${BASE:-http://localhost:3001}

post_lesson() {
  curl -sf -X POST "$BASE/api/lessons" \
    -H "x-access-key: $ACCESS_KEY" \
    -H "Content-Type: application/json" \
    -d @"$1"
}

delete_lesson() {
  curl -sf -X DELETE "$BASE/api/lessons/$1" -H "x-access-key: $ACCESS_KEY" >/dev/null
}

cleanup() {
  for ID in "${SESSION_ID:-}" "${RCP_ID:-}" "${PRE_ID:-}"; do
    if [ -n "$ID" ]; then
      delete_lesson "$ID" || true
    fi
  done
}
trap cleanup EXIT

echo "== POST /api/lessons (regular session) =="
RESP=$(post_lesson scripts/fixtures/lesson_session.json)
SESSION_ID=$(echo "$RESP" | jq -r '.lesson.id')
echo "$RESP" | jq '{id: .lesson.id, imagesCreated, audioCreated}'

echo ""
echo "== POST /api/lessons (RCP session) =="
RESP=$(post_lesson scripts/fixtures/lesson_session_rcp.json)
RCP_ID=$(echo "$RESP" | jq -r '.lesson.id')
echo "$RESP" | jq '{id: .lesson.id, imagesCreated, audioCreated}'

echo ""
echo "== POST /api/lessons (pre_test) =="
RESP=$(post_lesson scripts/fixtures/lesson_pre_test.json)
PRE_ID=$(echo "$RESP" | jq -r '.lesson.id')
echo "$RESP" | jq '{id: .lesson.id, imagesCreated, audioCreated}'

echo ""
echo "== Verify pre_test materialization (expect audio_count: 5, image_count: 1) =="
curl -sf "$BASE/api/lessons/$PRE_ID" -H "x-access-key: $ACCESS_KEY" | \
  jq '{lesson_id: .lesson.id, audio_count: (.audio|length), image_count: (.images|length), audio_filenames: [.audio[].cmsFilename], image_filenames: [.images[].cmsFilename]}'

echo ""
echo "== Verify RCP filename uses session-with-R suffix =="
curl -sf "$BASE/api/lessons/$RCP_ID" -H "x-access-key: $ACCESS_KEY" | \
  jq '{rcp_audio: [.audio[].cmsFilename], rcp_image: [.images[].cmsFilename]}'

echo ""
echo "Smoke OK"
