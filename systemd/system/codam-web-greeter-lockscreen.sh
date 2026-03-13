#!/bin/bash
set -euo pipefail

SKIPPED_USERS="lightdm exam checkin event"
LOCK_STATE_SCRIPT="/usr/share/codam/codam-web-greeter-lock-state.sh"
RUNTIME_DIR="/run/codam-web-greeter"
SESSION_CACHE_DIR="$RUNTIME_DIR/session-cache"
MAX_IDLE_SCREENLOCK_TIME_MINUTES=7
MAX_IDLE_SCREENLOCK_TIME=$((MAX_IDLE_SCREENLOCK_TIME_MINUTES * 60 * 1000))

is_uint() {
	[[ "$1" =~ ^[0-9]+$ ]]
}

ensure_runtime_dirs() {
	/usr/bin/mkdir -p "$SESSION_CACHE_DIR"
	/usr/bin/chmod 0755 "$RUNTIME_DIR" "$SESSION_CACHE_DIR"
}

get_session_property() {
	local session_id="$1"
	local property="$2"
	/usr/bin/loginctl show-session "$session_id" --property="$property" --value 2>/dev/null || true
}

get_current_monotonic_us() {
	/usr/bin/awk '{ printf "%d\n", $1 * 1000000 }' /proc/uptime
}

read_idle_ms() {
	local idle_hint="$1"
	local idle_since_hint_us="$2"

	if [ "$idle_hint" != "yes" ] || ! is_uint "$idle_since_hint_us" || [ "$idle_since_hint_us" -le 0 ] || [ "$CURRENT_MONOTONIC_US" -lt "$idle_since_hint_us" ]; then
		/usr/bin/echo 0
		return
	fi

	/usr/bin/echo $(((CURRENT_MONOTONIC_US - idle_since_hint_us) / 1000))
}

clear_stale_session_cache() {
	local sessions="$1"
	local file base session_id

	for file in "$SESSION_CACHE_DIR"/*; do
		[ -e "$file" ] || continue
		base="$(/usr/bin/basename "$file")"
		session_id="${base%%.*}"
		is_uint "$session_id" || continue
		if ! [[ " $sessions " =~ [[:space:]]$session_id[[:space:]] ]]; then
			/usr/bin/rm -f "$file"
		fi
	done
}

main() {
	local sessions session_id username active remote class service leader locked_hint idle_hint idle_since_hint_us idle_ms seat lock_status_file

	ensure_runtime_dirs
	CURRENT_MONOTONIC_US="$(get_current_monotonic_us)"
	sessions=$(/usr/bin/loginctl list-sessions --no-legend 2>/dev/null | /usr/bin/awk '{print $1}')
	clear_stale_session_cache " $sessions "

	for session_id in $sessions; do
		is_uint "$session_id" || continue

		username="$(get_session_property "$session_id" Name)"
		active="$(get_session_property "$session_id" Active)"
		remote="$(get_session_property "$session_id" Remote)"
		class="$(get_session_property "$session_id" Class)"
		service="$(get_session_property "$session_id" Service)"
		leader="$(get_session_property "$session_id" Leader)"
		locked_hint="$(get_session_property "$session_id" LockedHint)"
		idle_hint="$(get_session_property "$session_id" IdleHint)"
		idle_since_hint_us="$(get_session_property "$session_id" IdleSinceHintMonotonic)"
		seat="$(get_session_property "$session_id" Seat)"

		[ -n "$username" ] || continue
		is_uint "${leader:-0}" || continue
		if [[ $SKIPPED_USERS =~ (^|[[:space:]])$username($|[[:space:]]) ]]; then
			continue
		fi
		if [ "$remote" = "yes" ] || [ "$class" = "greeter" ] || [ "$service" = "lightdm" ]; then
			continue
		fi

		lock_status_file="$SESSION_CACHE_DIR/${session_id}.lock-status"
		idle_ms="$(read_idle_ms "$idle_hint" "$idle_since_hint_us")"

		if [ "$locked_hint" = "yes" ] && [ -x "$LOCK_STATE_SCRIPT" ]; then
			/bin/bash "$LOCK_STATE_SCRIPT" lock "$session_id" || true
		fi

		if [ "$locked_hint" != "yes" ] && [ -f "$lock_status_file" ]; then
			/usr/bin/rm -f "$lock_status_file"
			if [ -x "$LOCK_STATE_SCRIPT" ]; then
				/bin/bash "$LOCK_STATE_SCRIPT" unlock "$session_id" || true
			fi
		fi

		if [ "$active" != "yes" ] && [ "$locked_hint" != "yes" ]; then
			continue
		fi

		if [ "$idle_ms" -gt "$MAX_IDLE_SCREENLOCK_TIME" ]; then
			if [ ! -f "$lock_status_file" ]; then
				/usr/bin/printf 'locked_at=%s\nseat=%s\n' "$(/usr/bin/date +%s)" "$seat" > "$lock_status_file"
				/usr/bin/chmod 0600 "$lock_status_file"
				if [ -x "$LOCK_STATE_SCRIPT" ]; then
					/bin/bash "$LOCK_STATE_SCRIPT" lock "$session_id" || true
				fi
				/usr/bin/logger -t codam-web-greeter-lockscreen -- "action=lock-session user=$username session=$session_id seat=$seat idle_ms=$idle_ms"
				/usr/bin/dm-tool switch-to-greeter || true
			fi
		elif [ -f "$lock_status_file" ] && [ "$locked_hint" != "yes" ]; then
			/usr/bin/rm -f "$lock_status_file"
			if [ -x "$LOCK_STATE_SCRIPT" ]; then
				/bin/bash "$LOCK_STATE_SCRIPT" unlock "$session_id" || true
			fi
		fi
	done
}

main "$@"
