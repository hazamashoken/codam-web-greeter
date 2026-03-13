#!/bin/bash
set -euo pipefail

RUNTIME_DIR="/run/codam-web-greeter"
LOCK_DIR="$RUNTIME_DIR/lock"

usage() {
	/usr/bin/echo "Usage: $0 <lock|unlock> <session-id>" >&2
	exit 2
}

require_root() {
	if [ "${EUID}" -ne 0 ]; then
		/usr/bin/echo "Please run as root" >&2
		exit 1
	fi
}

is_uint() {
	[[ "$1" =~ ^[0-9]+$ ]]
}

main() {
	local action="${1:-}"
	local session_id="${2:-}"
	local lock_file

	require_root
	[ -n "$action" ] || usage
	[ -n "$session_id" ] || usage
	is_uint "$session_id" || usage

	/usr/bin/mkdir -p "$LOCK_DIR"
	/usr/bin/chmod 0755 "$RUNTIME_DIR" "$LOCK_DIR"

	lock_file="$LOCK_DIR/$session_id"

	case "$action" in
		lock)
			/usr/bin/date +%s > "$lock_file"
			/usr/bin/chmod 0600 "$lock_file"
			;;
		unlock)
			/usr/bin/rm -f "$lock_file"
			;;
		*)
			usage
			;;
	esac
}

main "$@"
