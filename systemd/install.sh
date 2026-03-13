#!/bin/bash

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
	/usr/bin/echo "Please run as root"
	/usr/bin/exit 1
fi

UNINSTALL_SCRIPT="/usr/share/codam/uninstall-codam-web-greeter-service.sh"
if [ -f "$UNINSTALL_SCRIPT" ]; then
	/usr/bin/echo "Uninstalling old version of codam-web-greeter..."
	/usr/bin/bash "$UNINSTALL_SCRIPT"
fi

ROOT_DIR="$(/usr/bin/dirname "$(/usr/bin/readlink -f "$0")")"
CONFIG_DIR="/etc/codam-web-greeter"
DEFAULT_CONFIG_SOURCE="$ROOT_DIR/system/codam-web-greeter-idler.conf"
DEFAULT_CONFIG_TARGET="$CONFIG_DIR/idler.conf"
AUDIT_HELPER="/usr/share/codam/codam-web-greeter-audit-setup.sh"
TMPFILES_TARGET="/usr/lib/tmpfiles.d/codam-web-greeter.conf"

/usr/bin/mkdir -p /usr/share/codam "$CONFIG_DIR"
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-notify.sh" /usr/share/codam/codam-web-greeter-exam-notify.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-restart.sh" /usr/share/codam/codam-web-greeter-exam-restart.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-fetcher.sh" /usr/share/codam/codam-web-greeter-fetcher.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler.sh" /usr/share/codam/codam-web-greeter-idler.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler.conf" /usr/share/codam/codam-web-greeter-idler.conf
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler-detect.sh" /usr/share/codam/codam-web-greeter-idler-detect.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-lock-state.sh" /usr/share/codam/codam-web-greeter-lock-state.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-lockscreen.sh" /usr/share/codam/codam-web-greeter-lockscreen.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-audit-setup.sh" /usr/share/codam/codam-web-greeter-audit-setup.sh
/usr/bin/chmod 700 /usr/share/codam/codam-web-greeter-idler.sh
/usr/bin/chmod 700 /usr/share/codam/codam-web-greeter-idler-detect.sh
/usr/bin/chmod 700 /usr/share/codam/codam-web-greeter-lock-state.sh
/usr/bin/chmod 700 /usr/share/codam/codam-web-greeter-lockscreen.sh
/usr/bin/chmod 700 /usr/share/codam/codam-web-greeter-audit-setup.sh
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler-hook.sh" /usr/share/codam/codam-web-greeter-idler-hook.sh
/usr/bin/chmod 500 /usr/share/codam/codam-web-greeter-idler-hook.sh
/usr/bin/cp "$ROOT_DIR/user/codam-web-greeter-init.sh" /usr/share/codam/codam-web-greeter-init.sh
/usr/bin/cp "$ROOT_DIR/user/codam-web-greeter-cleanup.sh" /usr/share/codam/codam-web-greeter-cleanup.sh
/usr/bin/install -m 0644 "$ROOT_DIR/system/codam-web-greeter-tmpfiles.conf" "$TMPFILES_TARGET"
/usr/bin/systemd-tmpfiles --create "$TMPFILES_TARGET"

if [ ! -f "$DEFAULT_CONFIG_TARGET" ]; then
	/usr/bin/install -m 0644 "$DEFAULT_CONFIG_SOURCE" "$DEFAULT_CONFIG_TARGET"
else
	/usr/bin/echo "Preserving existing $DEFAULT_CONFIG_TARGET"
fi

/usr/bin/cp "$ROOT_DIR/uninstall.sh" "$UNINSTALL_SCRIPT"
/usr/bin/chmod 700 "$UNINSTALL_SCRIPT"

if id codam-web-greeter >/dev/null 2>&1; then
	/usr/bin/echo "codam-web-greeter user already exists"
else
	/usr/sbin/adduser --system --group --shell /usr/sbin/nologin --disabled-password --home /dev/null codam-web-greeter
fi

WEB_GREETER_DIR="/usr/share/web-greeter/themes/codam"
DATA_FILE="$WEB_GREETER_DIR/data.json"
/usr/bin/mkdir -p "$WEB_GREETER_DIR"
/usr/bin/touch "$DATA_FILE"
/usr/bin/chmod 644 "$DATA_FILE"
/usr/bin/chown codam-web-greeter:codam-web-greeter "$DATA_FILE"
/usr/bin/echo '{"hostname": "nodata", "events": [], "exams": [], "exams_for_host": [], "fetch_time": 0, "message": "", "fixme": "To populate this file, set up the server-side of the greeter theme (see server directory in codam-web-greeter repository)"}' > "$DATA_FILE"

/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter.service" /etc/systemd/system/codam-web-greeter.service
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter.timer" /etc/systemd/system/codam-web-greeter.timer
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler.service" /etc/systemd/system/codam-web-greeter-idler.service
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-idler.timer" /etc/systemd/system/codam-web-greeter-idler.timer
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-lockscreen.service" /etc/systemd/system/codam-web-greeter-lockscreen.service
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-lockscreen.timer" /etc/systemd/system/codam-web-greeter-lockscreen.timer
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-restart.service" /etc/systemd/system/codam-web-greeter-exam-restart.service
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-restart.timer" /etc/systemd/system/codam-web-greeter-exam-restart.timer
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-notify.service" /etc/systemd/system/codam-web-greeter-exam-notify.service
/usr/bin/cp "$ROOT_DIR/system/codam-web-greeter-exam-notify.timer" /etc/systemd/system/codam-web-greeter-exam-notify.timer

/usr/bin/cp "$ROOT_DIR/user/codam-web-greeter.service" /etc/systemd/user/codam-web-greeter.service

/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable codam-web-greeter.timer
/usr/bin/systemctl start codam-web-greeter.timer
/usr/bin/systemctl enable codam-web-greeter-idler.timer
/usr/bin/systemctl start codam-web-greeter-idler.timer
/usr/bin/systemctl enable codam-web-greeter-lockscreen.timer
/usr/bin/systemctl start codam-web-greeter-lockscreen.timer
/usr/bin/systemctl enable codam-web-greeter-exam-restart.timer
/usr/bin/systemctl start codam-web-greeter-exam-restart.timer
/usr/bin/systemctl enable codam-web-greeter-exam-notify.timer
/usr/bin/systemctl start codam-web-greeter-exam-notify.timer
/usr/bin/systemctl start codam-web-greeter.service &
/usr/bin/systemctl --global enable codam-web-greeter.service

if [ -f "$DEFAULT_CONFIG_TARGET" ]; then
	# shellcheck disable=SC1090
	source "$DEFAULT_CONFIG_TARGET"
fi

if [ "${ENABLE_AUDITD:-1}" -eq 1 ]; then
	"$AUDIT_HELPER" || true
fi
