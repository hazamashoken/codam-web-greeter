#!/bin/bash

# Exit on error
set -e

# Get the data-server-url variable from the config file and append the hostname
DATA_SERVER_URL=$(/usr/bin/grep -Po '(?<=data-server-url=).*' /usr/share/web-greeter/themes/codam/settings.ini | /usr/bin/sed 's/^"\(.*\)"$/\1/')
DATA_SERVER_URL="$DATA_SERVER_URL$(/usr/bin/hostname)"
DATA_SERVER_API_KEY=$(/usr/bin/grep -Po '(?<=data-server-api-key=).*' /usr/share/web-greeter/themes/codam/settings.ini 2>/dev/null | /usr/bin/sed 's/^"\(.*\)"$/\1/' || true)

/usr/bin/echo "Starting run at $(/usr/bin/date)"
/usr/bin/echo "Fetching data from $DATA_SERVER_URL..."

# Get the data from the data server
if [ -n "${DATA_SERVER_API_KEY}" ]; then
	CURL_AUTH_HEADER=(--header "X-API-Key: ${DATA_SERVER_API_KEY}")
else
	CURL_AUTH_HEADER=()
fi

if ! DATA=$(/usr/bin/curl --fail --show-error --silent \
  --connect-timeout 5 --max-time 20 --retry 2 --retry-delay 1 \
  "${CURL_AUTH_HEADER[@]}" "$DATA_SERVER_URL"); then
  /usr/bin/echo "Failed to fetch data from data server"
  exit 1
fi

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
