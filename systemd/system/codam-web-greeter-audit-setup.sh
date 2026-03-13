#!/bin/bash
set -euo pipefail

RULES_DIR="/etc/audit/rules.d"
RULES_FILE="$RULES_DIR/codam-web-greeter-anti-idle.rules"
AUDIT_KEY="codam-web-greeter-anti-idle"
BINARIES=(
	/usr/bin/xdotool
	/usr/bin/ydotool
	/usr/bin/xte
	/usr/bin/dbus-send
	/usr/bin/gdbus
)

log() {
	/usr/bin/logger -t codam-web-greeter-audit -- "$*"
	/usr/bin/echo "$*"
}

main() {
	local tmp_file
	local wrote_rule=0
	local binary

	if [ "${EUID}" -ne 0 ]; then
		/usr/bin/echo "Please run as root" >&2
		exit 1
	fi

	if ! /usr/bin/command -v auditctl >/dev/null 2>&1; then
		log "action=skip reason=auditctl_missing"
		exit 0
	fi

	if [ ! -d "$RULES_DIR" ]; then
		log "action=skip reason=audit_rules_dir_missing path=$RULES_DIR"
		exit 0
	fi

	tmp_file=$(/usr/bin/mktemp)
	trap '/usr/bin/rm -f "$tmp_file"' EXIT

	for binary in "${BINARIES[@]}"; do
		if [ -x "$binary" ]; then
			/usr/bin/printf '%s\n' "-w $binary -p x -k $AUDIT_KEY" >> "$tmp_file"
			wrote_rule=1
		fi
	done

	if [ "$wrote_rule" -eq 0 ]; then
		/usr/bin/rm -f "$RULES_FILE"
		log "action=skip reason=no_supported_binaries"
		exit 0
	fi

	/usr/bin/mkdir -p "$RULES_DIR"
	/usr/bin/install -m 0640 "$tmp_file" "$RULES_FILE"

	if /usr/bin/command -v augenrules >/dev/null 2>&1; then
		if augenrules --load >/dev/null 2>&1; then
			log "action=install rules=$RULES_FILE loader=augenrules"
		else
			log "action=warn reason=augenrules_load_failed rules=$RULES_FILE"
		fi
	else
		log "action=install rules=$RULES_FILE loader=none"
	fi
}

main "$@"
