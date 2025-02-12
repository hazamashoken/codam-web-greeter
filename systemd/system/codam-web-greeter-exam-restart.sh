
#!/bin/bash

# Exit on error
set -e

DATA_FILE="/usr/share/web-greeter/themes/codam/data.json"

# Checking if 
CURRENT_TIME=$(/usr/bin/date -u +"%s")

LOGIN_USER=$(/usr/bin/who | /usr/bin/grep ":0" | /usr/bin/awk '{print $1}')
DBUS_ADDRESS=unix:path=/run/user/$(id -u ${LOGIN_USER})/bus

# Check if exams_for_host exists
if /usr/bin/jq -e 'has("exams_for_host")' "$DATA_FILE" >/dev/null; then
    # Parse JSON and get exam begin times
    EXAM_TIMES=$(/usr/bin/jq -r '.exams_for_host[].begin_at' "$DATA_FILE")
    EXAM_NAMES=$(/usr/bin/jq -r '.exams_for_host[].name' "$DATA_FILE")

    /usr/bin/echo "Exam exist for this host"

    for i in "${!EXAM_TIMES[@]}"; do
        EXAM_TIME=${EXAM_TIMES[$i]}
        EXAM_NAME=${EXAM_NAMES[$i]}
        # Calculate the alert time (20 minutes before exam)
        /usr/bin/echo "Exam time: $EXAM_TIME"
        EXAM_TIMESTAMP=$(/usr/bin/date -u -d "$EXAM_TIME" +"%s")
        AUTOMATIC_RESTART_TIME=$((EXAM_TIMESTAMP - 900 )) # 900 seconds = 15 minutes

        if (( CURRENT_TIME >= AUTOMATIC_RESTART_TIME && CURRENT_TIME < AUTOMATIC_RESTART_TIME + 60 )); then
            /usr/sbin/reboot
        fi

    done
fi