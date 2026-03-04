
#!/bin/bash

set -euo pipefail

DATA_FILE="/usr/share/web-greeter/themes/codam/data.json"
DISPLAY_VALUE="${DISPLAY:-:0}"
CURRENT_TIME=$(/usr/bin/date -u +"%s")
LOGIN_USER=$(/usr/bin/who | /usr/bin/awk '$2 == ":0" { print $1; exit }')

if [ -z "${LOGIN_USER}" ]; then
	/usr/bin/echo "No active graphical user session found, skipping exam notification"
	exit 0
fi

LOGIN_UID=$(/usr/bin/id -u "${LOGIN_USER}" 2>/dev/null || true)
if [ -z "${LOGIN_UID}" ]; then
	/usr/bin/echo "Could not determine UID for ${LOGIN_USER}, skipping exam notification"
	exit 0
fi

DBUS_ADDRESS="unix:path=/run/user/${LOGIN_UID}/bus"
if [ ! -S "/run/user/${LOGIN_UID}/bus" ]; then
	/usr/bin/echo "DBus session bus not found for ${LOGIN_USER}, skipping exam notification"
	exit 0
fi

if [ ! -f "${DATA_FILE}" ]; then
	/usr/bin/echo "Missing data file ${DATA_FILE}, skipping exam notification"
	exit 0
fi

if ! /usr/bin/jq -e '.exams_for_host and (.exams_for_host | type == "array") and (.exams_for_host | length > 0)' "${DATA_FILE}" >/dev/null; then
	/usr/bin/echo "No exams_for_host found in ${DATA_FILE}, skipping exam notification"
	exit 0
fi

readarray -t EXAM_TIMES < <(/usr/bin/jq -r '.exams_for_host[].begin_at' "${DATA_FILE}")
readarray -t EXAM_NAMES < <(/usr/bin/jq -r '.exams_for_host[].name' "${DATA_FILE}")

for i in "${!EXAM_TIMES[@]}"; do
	EXAM_TIME="${EXAM_TIMES[$i]}"
	EXAM_NAME="${EXAM_NAMES[$i]}"

	if ! EXAM_TIMESTAMP=$(/usr/bin/date -u -d "${EXAM_TIME}" +"%s" 2>/dev/null); then
		/usr/bin/echo "Could not parse exam time '${EXAM_TIME}', skipping"
		continue
	fi

	ALERT_TIMESTAMP=$((EXAM_TIMESTAMP - 1200)) # 20 minutes before exam start
	if (( CURRENT_TIME >= ALERT_TIMESTAMP && CURRENT_TIME < ALERT_TIMESTAMP + 60 )); then
		/usr/bin/echo "Sending exam notification for ${LOGIN_USER} at ${CURRENT_TIME}"
		/usr/bin/timeout 10s /usr/bin/sudo -u "${LOGIN_USER}" \
			DISPLAY="${DISPLAY_VALUE}" DBUS_SESSION_BUS_ADDRESS="${DBUS_ADDRESS}" \
			/usr/bin/notify-send -t 10000 -u critical -a "Exam" \
			"Exam Announcement" \
			"This machine is reserved for ${EXAM_NAME}. Automatic restart in 5 minutes. Please log out." || true

		if [ "${EXAM_NOTIFY_WITH_ZENITY:-false}" = "true" ]; then
			/usr/bin/timeout 15s /usr/bin/sudo -u "${LOGIN_USER}" \
				DISPLAY="${DISPLAY_VALUE}" DBUS_SESSION_BUS_ADDRESS="${DBUS_ADDRESS}" \
				/usr/bin/zenity --warning \
				--text="This machine is reserved for ${EXAM_NAME}.\n\nAutomatic restart in 5 minutes.\nPlease log out.\n\nThank you." || true
		fi
	fi
done
