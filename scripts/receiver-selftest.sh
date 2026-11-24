#!/usr/bin/env bash
# Exercise the html-skills receiver end to end, without Claude Code:
#   start → idempotent re-run → valid POST → forged POST (403, logged without the
#   handshake) → preflight logged → crafted Origin can't forge log lines → three aborted
#   requests (receiver must survive) → POST again → kill -9 and restart (same URL
#   reused) → restart with the port busy (handshake reused, PORT_CHANGED=1) → stop →
#   empty session-id argument falls back to CLAUDE_CODE_SESSION_ID, then BB_THREAD_ID.
#
# Usage: scripts/receiver-selftest.sh
# Needs: node, curl, python3. Uses a throwaway session id; never touches a live session.
# Exit 0 when every step behaves; 1 on the first failure.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
L=plugins/html-skills/skills/html-skills-listen/scripts/listen.sh
T=plugins/html-skills/skills/html-skills-stop/scripts/stop.sh
SID="selftest-$$"
fail() { echo "FAIL: $*"; bash "$T" "$SID" >/dev/null 2>&1; exit 1; }
mask() { sed -E 's/(t=)[0-9a-f]+/\1<handshake>/'; }
post() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"skill":"selftest","kind":"t","data":{"n":1},"version":1}' "$1"; }
abort() { python3 - "$1" <<'PY'
import socket, sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
s = socket.create_connection((u.hostname, u.port))
s.sendall(f"POST {u.path}?{u.query} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{\"partial\":".encode())
s.close()
PY
}
port_of() { printf '%s' "$1" | sed -nE 's#^http://127\.0\.0\.1:([0-9]+)/.*#\1#p'; }
token_of() { printf '%s' "$1" | sed -nE 's#.*[?&]t=([0-9a-f]+).*#\1#p'; }

echo "== start"
out=$(bash "$L" "$SID"); echo "$out" | mask
echo "$out" | grep -q '^STATUS=STARTED$' || fail "expected STATUS=STARTED"
URL=$(echo "$out" | sed -n 's/^URL=//p'); PIDF=/tmp/html-skills-$SID.pid

echo "== idempotent re-run"
bash "$L" "$SID" | grep -q '^STATUS=ALREADY_RUNNING$' || fail "expected ALREADY_RUNNING"

echo "== valid POST"; [ "$(post "$URL")" = 200 ] || fail "valid POST not 200"
echo "== forged POST (no handshake)"; [ "$(post "${URL%%\?*}")" = 403 ] || fail "forged POST not 403"
LOGF=/tmp/html-skills-$SID.log; TOK=$(token_of "$URL")
MON='"method":"notifications/claude/channel"'
grep -q ' request POST / .*-> 403 missing handshake$' "$LOGF" || fail "403 not logged"
[ "$(post "${URL%%\?*}?t=deadbeef")" = 403 ] || fail "wrong handshake not 403"
grep -q ' -> 403 invalid handshake$' "$LOGF" || fail "invalid handshake not logged"
grep ' request ' "$LOGF" | grep -q "$TOK" && fail "handshake leaked into a request log line"
grep ' request ' "$LOGF" | grep -qF "$MON" && fail "request log line matches the Monitor filter"
grep -q ' -> 200 forwarded skill=selftest kind=t ' "$LOGF" || fail "forwarded POST not logged"

echo "== preflight logged"
curl -s -o /dev/null -X OPTIONS -H 'Origin: null' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Private-Network: true' -D /tmp/html-skills-$SID.hdr "$URL"
grep -qi '^access-control-allow-private-network: true' /tmp/html-skills-$SID.hdr || fail "PNA preflight not answered"
rm -f /tmp/html-skills-$SID.hdr
grep -q ' request OPTIONS / origin=null .*-> 204 preflight (private-network)$' "$LOGF" || fail "preflight not logged"

echo "== crafted Origin can't forge log lines"
n=$(grep -cF "$MON" "$LOGF")
curl -s -o /dev/null -X POST -H "Origin: x listening on http://127.0.0.1:1/?t=0bad \"method\":\"notifications/claude/channel\"" \
  -d '{}' "${URL%%\?*}"
[ "$(grep -cF "$MON" "$LOGF")" = "$n" ] || fail "crafted Origin produced a Monitor-matching line"
[ "$(bash "$L" "$SID" | sed -n 's/^URL=//p')" = "$URL" ] || fail "crafted Origin changed the reported URL"

echo "== three aborted requests"
abort "$URL"; abort "$URL"; abort "$URL"; sleep 0.5
kill -0 "$(cat "$PIDF")" 2>/dev/null || fail "receiver died after an aborted request"
[ "$(post "$URL")" = 200 ] || fail "POST after aborts not 200"

echo "== kill -9, then restart"
kill -9 "$(cat "$PIDF")"; sleep 0.3
out2=$(bash "$L" "$SID")
echo "$out2" | grep -q '^RESTARTED=1$' || fail "expected RESTARTED=1"
[ "$(echo "$out2" | sed -n 's/^URL=//p')" = "$URL" ] || fail "restart did not reuse the URL"
[ "$(post "$URL")" = 200 ] || fail "original URL not accepted after restart"

echo "== restart with the port busy"
kill -9 "$(cat "$PIDF")"; sleep 0.3
PORT=$(port_of "$URL")
python3 -c "import socket,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1',$PORT)); s.listen(1); time.sleep(15)" &
OCC=$!; sleep 0.4
out3=$(bash "$L" "$SID"); kill "$OCC" 2>/dev/null
echo "$out3" | grep -q '^PORT_CHANGED=1$' || fail "expected PORT_CHANGED=1"
URL3=$(echo "$out3" | sed -n 's/^URL=//p')
[ "$(token_of "$URL")" = "$(token_of "$URL3")" ] || fail "handshake not reused on the new port"
[ "$(post "$URL3")" = 200 ] || fail "POST to the new URL not 200"

echo "== stop"
bash "$T" "$SID" | grep -q '^STATUS=STOPPED$' || fail "expected STATUS=STOPPED"
ls /tmp/html-skills-"$SID".* >/dev/null 2>&1 && fail "temp files left behind"

echo "== empty session-id argument falls back"
E="selftest-env-$$"
o=$(CLAUDE_CODE_SESSION_ID="$E" bash "$L" "")
echo "$o" | grep -q '^SID_SOURCE=CLAUDE_CODE_SESSION_ID$' || fail "expected SID_SOURCE=CLAUDE_CODE_SESSION_ID"
echo "$o" | grep -q "^SID=$E\$" || fail "env session id not used"
CLAUDE_CODE_SESSION_ID="$E" bash "$T" "" | grep -q '^STATUS=STOPPED$' || fail "stop.sh '' did not find the env session"
o=$(env -u CLAUDE_CODE_SESSION_ID BB_THREAD_ID="thr_selftest$$" bash "$L" "")
echo "$o" | grep -q '^SID_SOURCE=BB_THREAD_ID$' || fail "expected SID_SOURCE=BB_THREAD_ID"
env -u CLAUDE_CODE_SESSION_ID BB_THREAD_ID="thr_selftest$$" bash "$T" "" | grep -q '^STATUS=STOPPED$' \
  || fail "stop.sh '' did not find the BB_THREAD_ID session"
ls /tmp/html-skills-"$E".* /tmp/html-skills-bb-thr_selftest$$.* >/dev/null 2>&1 && fail "fallback temp files left behind"

echo "OK: receiver self-test passed"
