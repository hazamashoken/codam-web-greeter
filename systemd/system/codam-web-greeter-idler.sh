#!/bin/bash
set -euo pipefail

SKIPPED_USERS="lightdm exam checkin event"
DEFAULT_CONFIG="/usr/share/codam/codam-web-greeter-idler.conf"
CONFIG_FILE="/etc/codam-web-greeter/idler.conf"
HOOK_SCRIPT="/usr/share/codam/codam-web-greeter-idler-hook.sh"
DETECT_SCRIPT="/usr/share/codam/codam-web-greeter-idler-detect.sh"
LOCK_STATE_SCRIPT="/usr/share/codam/codam-web-greeter-lock-state.sh"
RUNTIME_DIR="/run/codam-web-greeter"
LOCK_DIR="$RUNTIME_DIR/lock"
OFFENSE_DIR="$RUNTIME_DIR/offenses"
SESSION_CACHE_DIR="$RUNTIME_DIR/session-cache"

MAX_IDLE_MINUTES=42
MAX_SESSION_HOURS=6
OFFENSE_WINDOW_SECONDS=1800
OFFENSE_THRESHOLD_USER_TERMINATE=2
ENABLE_AUDITD=1
ENABLE_PROCESS_KILL=1
ENABLE_SESSION_TERMINATE=1
ENABLE_USER_TERMINATE=1
ENABLE_LIGHTDM_RESTART=0

log_info() {
	/usr/bin/logger -t codam-web-greeter-idler -- "level=info $*"
}

log_warn() {
	/usr/bin/logger -p user.warning -t codam-web-greeter-idler -- "level=warn $*"
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

ensure_runtime_dirs() {
	/usr/bin/mkdir -p "$LOCK_DIR" "$OFFENSE_DIR" "$SESSION_CACHE_DIR"
	/usr/bin/chmod 0755 "$RUNTIME_DIR" "$LOCK_DIR" "$OFFENSE_DIR" "$SESSION_CACHE_DIR"
}

load_config() {
	if [ -f "$DEFAULT_CONFIG" ]; then
		# shellcheck disable=SC1090
		source "$DEFAULT_CONFIG"
	fi

	if [ -f "$CONFIG_FILE" ]; then
		# shellcheck disable=SC1090
		source "$CONFIG_FILE"
	fi

	MAX_IDLE_MS=$((MAX_IDLE_MINUTES * 60 * 1000))
	MAX_SESSION_SEC=$((MAX_SESSION_HOURS * 60 * 60))
}

get_session_property() {
	local session_id="$1"
	local property="$2"
	/usr/bin/loginctl show-session "$session_id" --property="$property" --value 2>/dev/null || true
}

get_current_monotonic_us() {
	/usr/bin/awk '{ printf "%d\n", $1 * 1000000 }' /proc/uptime
}

read_monotonic_duration_ms() {
	local since_us="$1"

	if ! is_uint "$since_us" || [ "$since_us" -le 0 ] || [ "$CURRENT_MONOTONIC_US" -lt "$since_us" ]; then
		/usr/bin/echo 0
		return
	fi

	/usr/bin/echo $(((CURRENT_MONOTONIC_US - since_us) / 1000))
}

read_session_age_sec() {
	local started_us="$1"

	if ! is_uint "$started_us" || [ "$started_us" -le 0 ] || [ "$CURRENT_MONOTONIC_US" -lt "$started_us" ]; then
		/usr/bin/echo 0
		return
	fi

	/usr/bin/echo $(((CURRENT_MONOTONIC_US - started_us) / 1000000))
}

read_lock_ms() {
	local session_id="$1"
	local lock_file="$LOCK_DIR/$session_id"
	local locked_at

	if [ ! -f "$lock_file" ]; then
		/usr/bin/echo 0
		return
	fi

	locked_at=$(/usr/bin/head -n 1 "$lock_file" 2>/dev/null || /usr/bin/echo 0)
	if ! is_uint "$locked_at" || [ "$locked_at" -le 0 ] || [ "$CURRENT_EPOCH" -lt "$locked_at" ]; then
		log_warn "action=ignore-lock-file reason=invalid_timestamp session=$session_id path=$lock_file"
		/usr/bin/echo 0
		return
	fi

	/usr/bin/echo $(((CURRENT_EPOCH - locked_at) * 1000))
}

log_legacy_lock_observation() {
	local username="$1"
	local legacy_file

	for legacy_file in \
		"/tmp/codam_web_greeter_lock_timestamp_${username}" \
		"/tmp/codam_web_greeter_lockscreen_timestamp_${username}"; do
		if [ -f "$legacy_file" ]; then
			log_info "action=legacy-lock-state-observed user=$username path=$legacy_file trusted=0"
		fi
	done
}

cleanup_stale_session_files() {
	local current_sessions="$1"
	local file base session_id

	for file in "$LOCK_DIR"/* "$SESSION_CACHE_DIR"/*; do
		[ -e "$file" ] || continue
		base="$(/usr/bin/basename "$file")"
		session_id="${base%%.*}"

		is_uint "$session_id" || continue
		if ! [[ " $current_sessions " =~ [[:space:]]$session_id[[:space:]] ]]; then
			/usr/bin/rm -f "$file"
		fi
	done
}

get_offense_count() {
	local username="$1"
	local offense_file="$OFFENSE_DIR/${username}.state"
	local count

	if [ ! -f "$offense_file" ]; then
		/usr/bin/echo 0
		return
	fi

	count=$(/usr/bin/awk -F= '/^offense_count=/{print $2}' "$offense_file" 2>/dev/null | /usr/bin/head -n 1)
	if ! is_uint "${count:-0}"; then
		/usr/bin/echo 0
		return
	fi

	/usr/bin/echo "$count"
}

record_offense() {
	local username="$1"
	local reason="$2"
	local suspicious_pids_csv="$3"
	local suspicious_commands="$4"
	local offense_file="$OFFENSE_DIR/${username}.state"
	local last_ts=0
	local current_count=0
	local new_count
	local tmp_file

	if [ -f "$offense_file" ]; then
		last_ts=$(/usr/bin/awk -F= '/^latest_offense_ts=/{print $2}' "$offense_file" 2>/dev/null | /usr/bin/head -n 1)
		current_count=$(/usr/bin/awk -F= '/^offense_count=/{print $2}' "$offense_file" 2>/dev/null | /usr/bin/head -n 1)
	fi

	is_uint "${last_ts:-0}" || last_ts=0
	is_uint "${current_count:-0}" || current_count=0

	if [ "$last_ts" -gt 0 ] && [ $((CURRENT_EPOCH - last_ts)) -le "$OFFENSE_WINDOW_SECONDS" ]; then
		new_count=$((current_count + 1))
	else
		new_count=1
	fi

	tmp_file=$(/usr/bin/mktemp)
	{
		/usr/bin/printf 'latest_offense_ts=%s\n' "$CURRENT_EPOCH"
		/usr/bin/printf 'offense_count=%s\n' "$new_count"
		/usr/bin/printf 'last_reason=%s\n' "$reason"
		/usr/bin/printf 'last_pids=%s\n' "$suspicious_pids_csv"
		/usr/bin/printf 'last_commands=%s\n' "$suspicious_commands"
	} > "$tmp_file"
	/usr/bin/install -m 0600 "$tmp_file" "$offense_file"
	/usr/bin/rm -f "$tmp_file"

	/usr/bin/echo "$new_count"
}

clear_session_state() {
	local session_id="$1"
	/usr/bin/rm -f "$LOCK_DIR/$session_id" "$SESSION_CACHE_DIR/${session_id}.lock-status"
}

kill_suspicious_pids() {
	local pids_csv="$1"
	local pid
	local pids=()

	IFS=',' read -r -a pids <<< "$pids_csv"
	for pid in "${pids[@]}"; do
		is_uint "$pid" || continue
		/usr/bin/kill -TERM "$pid" 2>/dev/null || true
	done

	/usr/bin/sleep 1

	for pid in "${pids[@]}"; do
		is_uint "$pid" || continue
		/usr/bin/kill -0 "$pid" 2>/dev/null || continue
		/usr/bin/kill -KILL "$pid" 2>/dev/null || true
	done
}

invoke_hook() {
	local username="$1"
	local session_id="$2"
	local reason="$3"
	local idle_ms="$4"
	local lock_ms="$5"
	local session_age_sec="$6"
	local suspicious_pids_csv="$7"
	local offense_count="$8"

	if [ ! -x "$HOOK_SCRIPT" ]; then
		return
	fi

	if ! /bin/bash "$HOOK_SCRIPT" \
		"$username" \
		"$session_id" \
		"$reason" \
		"$idle_ms" \
		"$lock_ms" \
		"$session_age_sec" \
		"$suspicious_pids_csv" \
		"$offense_count" \
		"$MAX_IDLE_MS" \
		"$MAX_SESSION_SEC"; then
		log_warn "action=hook-failed user=$username session=$session_id reason=$reason"
	fi
}

terminate_session() {
	local username="$1"
	local uid="$2"
	local session_id="$3"
	local seat="$4"
	local reason="$5"
	local offense_count="$6"
	local idle_ms="$7"
	local lock_ms="$8"
	local session_age_sec="$9"
	local suspicious_pids_csv="${10}"

	if [ "$ENABLE_SESSION_TERMINATE" -ne 1 ]; then
		log_info "action=session-terminate-disabled user=$username uid=$uid session=$session_id seat=$seat reason=$reason offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec"
		return
	fi

	log_warn "action=terminate-session user=$username uid=$uid session=$session_id seat=$seat reason=$reason offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec"
	/usr/bin/loginctl terminate-session "$session_id" || true
	clear_session_state "$session_id"
	invoke_hook "$username" "$session_id" "$reason" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv" "$offense_count"
}

terminate_user() {
	local username="$1"
	local uid="$2"
	local session_id="$3"
	local seat="$4"
	local reason="$5"
	local offense_count="$6"
	local idle_ms="$7"
	local lock_ms="$8"
	local session_age_sec="$9"
	local suspicious_pids_csv="${10}"

	if [ "$ENABLE_USER_TERMINATE" -ne 1 ]; then
		log_info "action=user-terminate-disabled user=$username uid=$uid session=$session_id seat=$seat reason=$reason offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec"
		return
	fi

	log_warn "action=terminate-user user=$username uid=$uid session=$session_id seat=$seat reason=$reason offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec"
	/usr/bin/loginctl terminate-user "$username" || true
	clear_session_state "$session_id"
	invoke_hook "$username" "$session_id" "$reason" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv" "$offense_count"

	if [ "$ENABLE_LIGHTDM_RESTART" -eq 1 ]; then
		log_warn "action=restart-lightdm user=$username session=$session_id reason=$reason"
		/usr/bin/systemctl restart lightdm || true
	fi
}

process_session() {
	local session_id="$1"
	local username uid active remote seat leader class service state idle_hint idle_since_hint_us locked_hint started_us
	local idle_ms=0
	local lock_ms=0
	local session_age_sec=0
	local detect_output=""
	local suspicious_pids_csv=""
	local suspicious_commands=""
	local offense_count=0
	local line pid command
	local reason

	username="$(get_session_property "$session_id" Name)"
	uid="$(get_session_property "$session_id" User)"
	active="$(get_session_property "$session_id" Active)"
	remote="$(get_session_property "$session_id" Remote)"
	seat="$(get_session_property "$session_id" Seat)"
	leader="$(get_session_property "$session_id" Leader)"
	class="$(get_session_property "$session_id" Class)"
	service="$(get_session_property "$session_id" Service)"
	state="$(get_session_property "$session_id" State)"
	idle_hint="$(get_session_property "$session_id" IdleHint)"
	idle_since_hint_us="$(get_session_property "$session_id" IdleSinceHintMonotonic)"
	locked_hint="$(get_session_property "$session_id" LockedHint)"
	started_us="$(get_session_property "$session_id" TimestampMonotonic)"

	[ -n "$username" ] || return
	is_uint "${uid:-0}" || return
	is_uint "${leader:-0}" || return

	if [[ $SKIPPED_USERS =~ (^|[[:space:]])$username($|[[:space:]]) ]]; then
		return
	fi

	if [ "$remote" = "yes" ] || [ "$class" = "greeter" ] || [ "$service" = "lightdm" ] || [ "$state" = "closing" ]; then
		return
	fi

	lock_ms="$(read_lock_ms "$session_id")"
	if [ "$lock_ms" -eq 0 ]; then
		log_legacy_lock_observation "$username"
	fi

	if [ "$active" != "yes" ] && [ "$lock_ms" -eq 0 ] && [ "$locked_hint" != "yes" ]; then
		return
	fi

	if [ "$idle_hint" = "yes" ]; then
		idle_ms="$(read_monotonic_duration_ms "$idle_since_hint_us")"
	fi
	if [ "$locked_hint" = "yes" ] && [ "$lock_ms" -eq 0 ] && [ -x "$LOCK_STATE_SCRIPT" ]; then
		/bin/bash "$LOCK_STATE_SCRIPT" lock "$session_id" || true
		lock_ms="$(read_lock_ms "$session_id")"
	fi
	session_age_sec="$(read_session_age_sec "$started_us")"

	if [ -x "$DETECT_SCRIPT" ]; then
		detect_output=$(/bin/bash "$DETECT_SCRIPT" "$username" "$session_id" 2>/dev/null || true)
	fi

	if [ -n "$detect_output" ]; then
		while IFS= read -r line; do
			[ -n "$line" ] || continue
			pid="${line%%$'\t'*}"
			command="${line#*$'\t'}"
			is_uint "$pid" || continue
			suspicious_pids_csv+="${suspicious_pids_csv:+,}$pid"
			suspicious_commands+="${suspicious_commands:+ ; }$command"
		done <<< "$detect_output"

		offense_count="$(record_offense "$username" "suspicious_process" "$suspicious_pids_csv" "$suspicious_commands")"
		log_warn "action=detect-suspicious user=$username uid=$uid session=$session_id seat=$seat reason=suspicious_process offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec commands=$suspicious_commands"

		if [ "$ENABLE_PROCESS_KILL" -eq 1 ] && [ -n "$suspicious_pids_csv" ]; then
			kill_suspicious_pids "$suspicious_pids_csv"
			log_warn "action=kill-pids user=$username uid=$uid session=$session_id seat=$seat reason=suspicious_process offense_count=$offense_count pids=$suspicious_pids_csv idle_ms=$idle_ms lock_ms=$lock_ms session_age_sec=$session_age_sec"
			if [ "$offense_count" -lt 2 ]; then
				invoke_hook "$username" "$session_id" "suspicious_process" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv" "$offense_count"
			fi
		fi

		if [ "$offense_count" -gt "$OFFENSE_THRESHOLD_USER_TERMINATE" ]; then
			terminate_user "$username" "$uid" "$session_id" "$seat" "suspicious_process" "$offense_count" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv"
			return
		fi

		if [ "$offense_count" -ge 2 ]; then
			terminate_session "$username" "$uid" "$session_id" "$seat" "suspicious_process" "$offense_count" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv"
			return
		fi
	else
		offense_count="$(get_offense_count "$username")"
	fi

	if [ "$session_age_sec" -gt "$MAX_SESSION_SEC" ]; then
		reason="hard_session_cap"
		terminate_session "$username" "$uid" "$session_id" "$seat" "$reason" "$offense_count" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv"
		return
	fi

	if [ "$lock_ms" -gt "$MAX_IDLE_MS" ]; then
		reason="locked_too_long"
		terminate_session "$username" "$uid" "$session_id" "$seat" "$reason" "$offense_count" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv"
		return
	fi

	if [ "$idle_ms" -gt "$MAX_IDLE_MS" ]; then
		reason="idle_timeout"
		terminate_session "$username" "$uid" "$session_id" "$seat" "$reason" "$offense_count" "$idle_ms" "$lock_ms" "$session_age_sec" "$suspicious_pids_csv"
		return
	fi

}

main() {
	local sessions
	local session_id

	require_root
	ensure_runtime_dirs
	load_config
	CURRENT_EPOCH=$(/usr/bin/date +%s)
	CURRENT_MONOTONIC_US="$(get_current_monotonic_us)"
	sessions=$(/usr/bin/loginctl list-sessions --no-legend 2>/dev/null | /usr/bin/awk '{print $1}')
	cleanup_stale_session_files " $sessions "

	for session_id in $sessions; do
		is_uint "$session_id" || continue
		process_session "$session_id"
	done
}

main "$@"
