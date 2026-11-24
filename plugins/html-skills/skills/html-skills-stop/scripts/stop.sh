#!/usr/bin/env bash
# html-skills-stop — kills this session's html-skills receiver and cleans up
# its temp files. The Monitor task id lives in /tmp/html-skills-$SID.monitor-id
# and must be stopped by the agent via TaskStop (Monitor is a Claude Code tool,
# not a shell concept): this script prints the id, the SKILL.md does the call.
#
# Usage: stop.sh [session-id]
#   An empty argument falls back to $CLAUDE_CODE_SESSION_ID, then $BB_THREAD_ID
#   (as "bb-<id>"), then "no-session". Keep this resolution identical to listen.sh's.
#
# Output: KEY=VALUE lines.
#   STATUS=WEB         — nothing was running here; web session.
#   STATUS=INACTIVE    — no PID file; nothing to kill.
#   STATUS=STOPPED     — receiver killed, files cleaned. MONITOR_ID printed if
#                        there was one saved (parent skill should TaskStop it).

set -u

# Same resolution and sanitising as listen.sh — keep the two in sync.
if [ -n "${1:-}" ]; then
  SID="$1"
elif [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  SID="$CLAUDE_CODE_SESSION_ID"
elif [ -n "${BB_THREAD_ID:-}" ]; then
  SID="bb-$BB_THREAD_ID"
else
  SID=no-session
fi
SID=$(printf '%s' "$SID" | tr -c 'A-Za-z0-9._-' '_')
PIDF=/tmp/html-skills-$SID.pid
LOGF=/tmp/html-skills-$SID.log
URLF=/tmp/html-skills-$SID.url
MIDF=/tmp/html-skills-$SID.monitor-id

echo "SID=$SID"

if [ -n "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ]; then
  echo "STATUS=WEB"
  exit 0
fi

if [ ! -f "$PIDF" ]; then
  echo "STATUS=INACTIVE"
  exit 0
fi

# Print the Monitor task id first (parent SKILL.md will TaskStop it).
if [ -s "$MIDF" ]; then
  echo "MONITOR_ID=$(cat "$MIDF")"
fi

PID=$(cat "$PIDF")
kill "$PID" 2>/dev/null || true

rm -f "$PIDF" "$LOGF" "$URLF" "$MIDF"

echo "STATUS=STOPPED"
