#!/bin/bash

# Exit on error
set -e

# Get logged in users
WHO_OUTPUT=$(/usr/bin/who)

# Loop through output
while IFS= read -r line; do
	# Get username
	USERNAME=$(echo "$line" | awk '{print $1}')
	# Get display (everything between () and remove the ())
	# Cannot use awk here to print a specific column because columns might contain spaces...
	DISPLAY=$(echo "$line" | sed -n 's/.*(\(.*\))/\1/p')
	# Go to next line if display does not start with :
	if ! [[ "$DISPLAY" =~ ^: ]]; then
		continue
	fi

	# Get idle time from X-session using sudo
	# This time is used to determine if the session has been idle for too long (possibly without locking the screen)
	IDLE_TIME=$(/usr/bin/sudo -u "$USERNAME" DISPLAY="$DISPLAY" /usr/bin/xprintidle)

	# Check if lock_timestamp file exists, and if so read the locked_at_timestamp
	# This time is used to determine if the screen lock has been active for too long
	# Sometimes xprintidle doesn't work properly when the screen is locked due to programs running in the user session in the background
	TIME_SINCE_LOCK=$((0)) # Placeholder
	if [ -f "/tmp/codam_web_greeter_lockscreen_timestamp_$USERNAME" ]; then
		# Get the locked_at_timestamp from the file	
		LOCKED_AT_TIMESTAMP=$(/usr/bin/awk '{print $1}' "/tmp/codam_web_greeter_lockscreen_timestamp_$USERNAME")
		# Calculate the time since the session was locked
		TIME_SINCE_LOCK=$((($(date +%s) - LOCKED_AT_TIMESTAMP) * 1000))
	fi



	# 42Singapore: Ad Hoc method to lockscreen idle user after 3 minutes
	# if the screen blanks on the lock screen use '/usr/bin/dm-tool switch-to-greeter' instead: https://github.com/hazamashoken/codam-web-greeter/tree/main?tab=readme-ov-file#the-screen-blanks-on-the-lock-screen
	# Check if session has been idle for long enough
	MAX_IDLE_SCREENLOCK_TIME_MINUTES=$((7))
	MAX_IDLE_SCREENLOCK_TIME=$((MAX_IDLE_SCREENLOCK_TIME_MINUTES * 60 * 1000))
	LOCK_STATUS_FILE="/tmp/codam_web_greeter_lockscreen_status_$USERNAME"

	if [ "$IDLE_TIME" -gt "$MAX_IDLE_SCREENLOCK_TIME" ]; then
		# Create the lock status file if it doesn't exist
		if [ ! -f "$LOCK_STATUS_FILE" ]; then
			echo "Session for $USERNAME has been idle for over 3 minutes (idletime $IDLE_TIME ms). Preparing to lock screen."
			echo "pending" > "$LOCK_STATUS_FILE"
		fi

		# Check if the lock status file indicates "locked"
		if [ "$(cat "$LOCK_STATUS_FILE")" != "locked" ]; then
			echo "Locking session for $USERNAME..."
			echo "locked" > "$LOCK_STATUS_FILE"
			/usr/bin/dm-tool switch-to-greeter
		fi
	else
		# If the idle time is not enough, remove the lock status file
		if [ -f "$LOCK_STATUS_FILE" ]; then
			echo "Session for $USERNAME is active again (idletime $IDLE_TIME ms). Removing lock status file."
			rm -f "$LOCK_STATUS_FILE"
		fi
	fi

done <<< "$WHO_OUTPUT"
