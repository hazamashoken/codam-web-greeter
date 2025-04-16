
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
    readarray -t EXAM_TIMES < <(/usr/bin/jq -r '.exams_for_host[].begin_at' "$DATA_FILE")
    readarray -t EXAM_NAMES < <(/usr/bin/jq -r '.exams_for_host[].name' "$DATA_FILE")

    /usr/bin/echo "Exam exist for this host"

    for i in "${!EXAM_TIMES[@]}"; do
        EXAM_TIME=${EXAM_TIMES[$i]}
        EXAM_NAME=${EXAM_NAMES[$i]}
        # Calculate the alert time (20 minutes before exam)
        /usr/bin/echo "Exam time: $EXAM_TIME"
        EXAM_TIMESTAMP=$(/usr/bin/date -u -d "$EXAM_TIME" +"%s")
        ALERT_TIMESTAMP=$((EXAM_TIMESTAMP - 1200)) # 1200 seconds = 20 minutes
        
        if (( CURRENT_TIME >= ALERT_TIMESTAMP && CURRENT_TIME < ALERT_TIMESTAMP + 60 )); then
            /usr/bin/echo "Showing restart aleart for $LOGIN_USER at $CURRENT_TIME"
            TIME_MSG=$(/usr/bin/date -u )
            sudo -u $LOGIN_USER DISPLAY=${DISPLAY} DBUS_SESSION_BUS_ADDRESS=${DBUS_ADDRESS} /usr/bin/notify-send -t 0 -u critical -a "Exam" "Exam Annoucemnt" "This machine is reserve for $EXAM_NAME.\nAutomatic restart in 5 minutes.\nPlease logout.\nThank you"
            sudo -u $LOGIN_USER DISPLAY=${DISPLAY} DBUS_SESSION_BUS_ADDRESS=${DBUS_ADDRESS} /usr/bin/zenity --warning --text="This machine is reserve for $EXAM_NAME.\n\nAutomatic restart in 5 minutes.\nPlease logout.\n\nThank you"
        fi

    done
fi