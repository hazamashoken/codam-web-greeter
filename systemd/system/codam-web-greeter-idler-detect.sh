#!/bin/bash
set -euo pipefail

PS_BIN="${PS_BIN:-/usr/bin/ps}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"

usage() {
	/usr/bin/echo "Usage: $0 <username> <session-id>" >&2
	exit 2
}

is_uint() {
	[[ "$1" =~ ^[0-9]+$ ]]
}

matches_suspicious_command() {
	local command="$1"
	local direct_tool_regex='(^|[[:space:]])([^[:space:]]*/)?(xdotool|ydotool|xte|dbus-send|gdbus)([[:space:]]|$)'
	local driver_regex='(^|[[:space:]])([^[:space:]]*/)?(python|python3|bash|sh|node|perl)([[:space:]]|$)'
	local loop_regex='while[[:space:]]+true|for[[:space:]]*\([[:space:]]*;[[:space:]]*;[[:space:]]*\)|until[[:space:]]+false'
	local short_sleep_regex='sleep[[:space:]]+(0(\.[0-9]+)?|1(\.[0-9]+)?)($|[[:space:];])'
	local fake_input_regex='xdotool|ydotool|xte|dbus-send|gdbus|mousemove|mouse(up|down|move)|key(up|down)?|click|org\.gnome\.ScreenSaver|org\.gnome\.SessionManager|XTestFake'

	if [[ "$command" =~ $direct_tool_regex ]]; then
		return 0
	fi

	if [[ "$command" =~ $driver_regex ]] && [[ "$command" =~ $fake_input_regex ]] && ([[ "$command" =~ $loop_regex ]] || [[ "$command" =~ $short_sleep_regex ]]); then
		return 0
	fi

	return 1
}

pid_in_session() {
	local pid="$1"
	local control_group="$2"

	if [ -z "$control_group" ]; then
		return 0
	fi

	[ -r "/proc/$pid/cgroup" ] || return 1
	/usr/bin/grep -Fq "$control_group" "/proc/$pid/cgroup"
}

main() {
	local username="${1:-}"
	local session_id="${2:-}"
	local control_group=""
	local line pid command

	[ -n "$username" ] || usage
	[ -n "$session_id" ] || usage
	is_uint "$session_id" || usage

	control_group=$("$SYSTEMCTL_BIN" show "session-${session_id}.scope" --property=ControlGroup --value 2>/dev/null || true)

	while IFS= read -r line; do
		pid="${line%% *}"
		command="${line#* }"

		is_uint "$pid" || continue
		[ "$pid" -ne $$ ] || continue
		pid_in_session "$pid" "$control_group" || continue
		matches_suspicious_command "$command" || continue

		/usr/bin/printf '%s\t%s\n' "$pid" "$command"
	done < <("$PS_BIN" -u "$username" -o pid= -o args= 2>/dev/null || true)
}

main "$@"
