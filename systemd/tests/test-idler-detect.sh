#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)/system"
DETECT_SCRIPT="$SCRIPT_DIR/codam-web-greeter-idler-detect.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/ps" <<'PS'
#!/bin/bash
cat <<'OUT'
1001 /usr/bin/xdotool mousemove 10 10
1002 python3 -c 'import time;\nwhile true: time.sleep(1); print("noop")'
1003 bash -lc 'while true; do xdotool key Shift_L; sleep 1; done'
OUT
PS
chmod +x "$TMP_DIR/ps"

cat > "$TMP_DIR/systemctl" <<'SC'
#!/bin/bash
if [ "$1" = "show" ]; then
	echo ""
fi
SC
chmod +x "$TMP_DIR/systemctl"

OUTPUT=$(PS_BIN="$TMP_DIR/ps" SYSTEMCTL_BIN="$TMP_DIR/systemctl" "$DETECT_SCRIPT" alice 7)

echo "$OUTPUT" | grep -q '^1001'
echo "$OUTPUT" | grep -q '^1003'
if echo "$OUTPUT" | grep -q '^1002'; then
	echo "unexpected false positive for benign python command" >&2
	exit 1
fi
