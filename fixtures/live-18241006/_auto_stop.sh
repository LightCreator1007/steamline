#!/usr/bin/env bash
# Watches the running recorder for fixture 18241006 and stops it automatically:
# - primary: game_finalised / StatusId 100 seen in the live scores.jsonl, plus a
#   10-minute buffer for any trailing proof fetches or late stat events.
# - backstop: a hard deadline (kickoff + 4h) in case finalisation is never seen
#   (network hiccup, extra time + penalties running very long, etc.), so this
#   cannot run all night unattended and unbounded.
set -u
cd "$(dirname "$0")/../.."

FIXTURE_ID=18241006
OUT_DIR="fixtures/live-18241006"
SCORES_FILE="$OUT_DIR/$FIXTURE_ID/scores.jsonl"
LOG="$OUT_DIR/_auto_stop.log"
DEADLINE_EPOCH=$(date -u -d "2026-07-15T23:00:00Z" +%s)   # kickoff 19:00 UTC + 4h
BUFFER_SECONDS=600                                          # 10 min after finalisation

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$1" >> "$LOG"; }

log "auto-stop watcher started (pid $$), hard deadline $(date -u -d @"$DEADLINE_EPOCH" '+%Y-%m-%d %H:%M:%S UTC')"

FINALISED_AT=""
while true; do
  NOW=$(date +%s)

  if [ -f "$SCORES_FILE" ] && grep -qE '"StatusId":100|"Action":"game_finalised"' "$SCORES_FILE" 2>/dev/null; then
    if [ -z "$FINALISED_AT" ]; then
      FINALISED_AT=$NOW
      log "game_finalised detected; stopping in ${BUFFER_SECONDS}s buffer"
    elif [ $((NOW - FINALISED_AT)) -ge "$BUFFER_SECONDS" ]; then
      log "buffer elapsed after finalisation, stopping recorder"
      break
    fi
  fi

  if [ "$NOW" -ge "$DEADLINE_EPOCH" ]; then
    log "hard deadline reached without confirmed finalisation, stopping recorder anyway"
    break
  fi

  sleep 30
done

PIDS=$(pgrep -f "recorder.ts --fixtures $FIXTURE_ID")
if [ -n "$PIDS" ]; then
  log "sending SIGTERM to: $PIDS"
  kill $PIDS 2>/dev/null
  sleep 5
  STILL=$(pgrep -f "recorder.ts --fixtures $FIXTURE_ID")
  if [ -n "$STILL" ]; then
    log "still alive after SIGTERM, sending SIGKILL to: $STILL"
    kill -9 $STILL 2>/dev/null
  fi
else
  log "no matching recorder process found (already stopped?)"
fi

log "watcher done, exiting"
