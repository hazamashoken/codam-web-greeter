
#!/bin/bash

# Exit on error
set -e

DATA_FILE="/usr/share/web-greeter/themes/codam/data.json"

# Checking if 
CURRENT_TIME=$(/usr/bin/date -u +"%s")



# Check if exams_for_host exists
if /usr/bin/jq -e 'has("exams_for_host")' "$DATA_FILE" >/dev/null; then
    # Parse JSON and get exam begin times
    EXAM_TIMES=$(/usr/bin/jq -r '.exams_for_host[].begin_at' "$DATA_FILE")

    /usr/bin/echo "Exam exist for this host"

    for EXAM_TIME in $EXAM_TIMES; do
        # Calculate the alert time (20 minutes before exam)
        /usr/bin/echo "Exam time: $EXAM_TIME"
        EXAM_TIMESTAMP=$(/usr/bin/date -u -d "$EXAM_TIME" +"%s")
        ALERT_TIMESTAMP=$((EXAM_TIMESTAMP - 1200)) # 1200 seconds = 20 minutes
        AUTOMATIC_RESTART_TIME=$((ALERT_TIMESTAMP + 300 )) # 300 seconds = 5 minutes
        
        /usr/bin/echo "CURRENT_TIME: $CURRENT_TIME"
        /usr/bin/echo "EXAM_TIMESTAMP: $EXAM_TIMESTAMP"
        /usr/bin/echo "ALERT_TIMESTAMP: $ALERT_TIMESTAMP"
        /usr/bin/echo "ALERT_TIMESTAMP: $((ALERT_TIMESTAMP + 60))"
        /usr/bin/echo "AUTOMATIC_RESTART_TIME: $AUTOMATIC_RESTART_TIME"

        if (( CURRENT_TIME >= ALERT_TIMESTAMP && CURRENT_TIME < ALERT_TIMESTAMP + 60 )); then
            /usr/bin/echo "Showing restart aleart for $USER at $CURRENT_TIME"
            /usr/bin/zenity --warning --text="This machine is reserve for exam at $EXAM_TIME.\n\nAutomatic restart in 5 minutes.\nPlease logout.\n\nThank you"
        fi

        if (( CURRENT_TIME >= AUTOMATIC_RESTART_TIME && CURRENT_TIME < AUTOMATIC_RESTART_TIME + 60 )); then
            # reboot
            /usr/bin/echo "Rebooting at $CURRENT_TIME"
            /usr/bin/zenity --info --text="REBOOTING"
        fi

    done
fi