#!/bin/bash

# Exit on error
set -e

# Get the data-server-url variable from the config file and append the hostname
DATA_SERVER_URL=$(/usr/bin/grep -Po '(?<=data-server-url=).*' /usr/share/web-greeter/themes/codam/settings.ini | /usr/bin/sed 's/^"\(.*\)"$/\1/')
DATA_SERVER_URL="$DATA_SERVER_URL$(/usr/bin/hostname)"

/usr/bin/echo "Starting run at $(/usr/bin/date)"
/usr/bin/echo "Fetching data from $DATA_SERVER_URL..."

# Get the data from the data server
DATA=$(/usr/bin/curl -s "$DATA_SERVER_URL")

# Check if the data is valid JSON
if ! /usr/bin/jq -e . >/dev/null 2>&1 <<<"$DATA"; then
  /usr/bin/echo "Invalid JSON data received from data server"
  exit 1
else
  /usr/bin/echo "Valid JSON data received from data server"
fi

# Create a file for the data with the correct permissions and store the data in it
DATA_FILE="/usr/share/web-greeter/themes/codam/data.json"
/usr/bin/touch "$DATA_FILE"
/usr/bin/chmod 644 "$DATA_FILE"
/usr/bin/chown codam-web-greeter:codam-web-greeter "$DATA_FILE"
/usr/bin/echo "$DATA" > "$DATA_FILE"

/usr/bin/echo "Data fetched successfully and saved to $DATA_FILE"


# Checking if 
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:00.000Z")

AUTOMATIC_RESTART_TIME=$(date -u -d "$CURRENT_TIME + 5 minutes" +"%Y-%m-%dT%H:%M:00.000Z")

# Check if exams_for_host exists
if jq -e 'has("exams_for_host")' "$DATA" >/dev/null; then
    # Parse JSON and get exam begin times
    EXAM_TIMES=$(jq -r '.exams_for_host[].begin_at' "$DATA")

    for EXAM_TIME in $EXAM_TIMES; do
        # Calculate the alert time (20 minutes before exam)
        ALERT_TIME=$(date -u -d "$EXAM_TIME - 20 minutes" +"%Y-%m-%dT%H:%M:00.000Z")
        
        if [[ "$CURRENT_TIME" == "$ALERT_TIME" ]]; then
            zenity --warning --text="Hi $USER,\n\nThis machine has an exam scheduled at $EXAM_TIME.\n\nPlease logout as automatic restart will happen in 5 min.\n\nThank you."
        fi

        if [[ "$CURRENT_TIME" == "$AUTOMATIC_RESTART_TIME" ]]; then
            notify-send "Rebooting"
        fi

    done
fi