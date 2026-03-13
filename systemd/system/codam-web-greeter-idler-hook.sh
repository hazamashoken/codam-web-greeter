#!/bin/bash
#
# This script is executed after an idler enforcement action in codam-web-greeter-idler.sh.
# It receives the following arguments:
# $1: username
# $2: session ID
# $3: reason (suspicious_process, locked_too_long, idle_timeout, hard_session_cap)
# $4: idle time in milliseconds
# $5: lock duration in milliseconds
# $6: session age in seconds
# $7: suspicious PID list as CSV
# $8: offense count in the rolling window
# $9: max idle time in milliseconds
# $10: max session age in seconds
#
# Existing campus customizations can ignore the extra arguments and keep reading $1..$4.
# You can use this script to forward evidence into local logging, notifications, or incident tooling.
#
# Example:
# LOGFILE="/var/log/codam-web-greeter-idle-logout.log"
# echo "$(date): user='$1' session='$2' reason='$3' idle_ms='$4' lock_ms='$5' session_age_sec='$6' suspicious_pids='$7' offense_count='$8' max_idle_ms='$9' max_session_sec='${10}'" >> "$LOGFILE"
