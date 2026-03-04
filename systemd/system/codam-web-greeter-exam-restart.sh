
#!/bin/bash

set -euo pipefail

DATA_FILE="/usr/share/web-greeter/themes/codam/data.json"
CURRENT_TIME=$(/usr/bin/date -u +"%s")
LOGIN_USER=$(/usr/bin/who | /usr/bin/awk '$2 == ":0" { print $1; exit }')

if [ -z "${LOGIN_USER}" ]; then
	/usr/bin/echo "No active graphical user session found, skipping exam restart"
	exit 0
fi

if [ ! -f "${DATA_FILE}" ]; then
	/usr/bin/echo "Missing data file ${DATA_FILE}, skipping exam restart"
	exit 0
fi

if ! /usr/bin/jq -e '.exams_for_host and (.exams_for_host | type == "array") and (.exams_for_host | length > 0)' "${DATA_FILE}" >/dev/null; then
	/usr/bin/echo "No exams_for_host found in ${DATA_FILE}, skipping exam restart"
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

	AUTOMATIC_RESTART_TIME=$((EXAM_TIMESTAMP - 900)) # 15 minutes before exam start
	if (( CURRENT_TIME >= AUTOMATIC_RESTART_TIME && CURRENT_TIME < AUTOMATIC_RESTART_TIME + 60 )); then
		/usr/bin/echo "Rebooting machine for upcoming exam '${EXAM_NAME}'"
		/usr/sbin/reboot
	fi
done
