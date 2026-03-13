#!/bin/bash

set +e

if [ "$EUID" -ne 0 ]; then
	/usr/bin/echo "Please run as root"
	/usr/bin/exit 1
fi

/usr/bin/systemctl disable codam-web-greeter.timer
/usr/bin/systemctl stop codam-web-greeter.timer
/usr/bin/systemctl disable codam-web-greeter-idler.timer
/usr/bin/systemctl stop codam-web-greeter-idler.timer
/usr/bin/systemctl disable codam-web-greeter-lockscreen.timer
/usr/bin/systemctl stop codam-web-greeter-lockscreen.timer
/usr/bin/systemctl disable codam-web-greeter-exam-notify.timer
/usr/bin/systemctl stop codam-web-greeter-exam-notify.timer
/usr/bin/systemctl disable codam-web-greeter-exam-restart.timer
/usr/bin/systemctl stop codam-web-greeter-exam-restart.timer

/usr/bin/systemctl --global disable codam-web-greeter.service

/usr/bin/rm /etc/systemd/system/codam-web-greeter.service
/usr/bin/rm /etc/systemd/system/codam-web-greeter.timer
/usr/bin/rm /etc/systemd/system/codam-web-greeter-idler.service
/usr/bin/rm /etc/systemd/system/codam-web-greeter-idler.timer
/usr/bin/rm /etc/systemd/system/codam-web-greeter-lockscreen.service
/usr/bin/rm /etc/systemd/system/codam-web-greeter-lockscreen.timer
/usr/bin/rm /etc/systemd/system/codam-web-greeter-exam-notify.service
/usr/bin/rm /etc/systemd/system/codam-web-greeter-exam-notify.timer
/usr/bin/rm /etc/systemd/system/codam-web-greeter-exam-restart.service
/usr/bin/rm /etc/systemd/system/codam-web-greeter-exam-restart.timer
/usr/bin/rm /etc/systemd/user/codam-web-greeter.service
/usr/bin/rm -f /usr/lib/tmpfiles.d/codam-web-greeter.conf
/usr/bin/rm -f /etc/audit/rules.d/codam-web-greeter-anti-idle.rules

/usr/bin/systemctl daemon-reload
/usr/sbin/deluser codam-web-greeter
/usr/bin/rm /usr/share/codam/codam-web-greeter-*.sh
/usr/bin/rm -f /usr/share/codam/codam-web-greeter-idler.conf
/usr/bin/rm -rf /run/codam-web-greeter

DATA_JSON_FILE="/usr/share/web-greeter/themes/codam/data.json"
if [ -f "$DATA_JSON_FILE" ]; then
	/usr/bin/rm "$DATA_JSON_FILE"
fi

/usr/bin/rm /usr/share/codam/uninstall-codam-web-greeter-service.sh

CODAM_SHARE_FILES=$(/usr/bin/ls -A /usr/share/codam 2>/dev/null | /usr/bin/wc -l)
if [ "$CODAM_SHARE_FILES" -eq 0 ]; then
	/usr/bin/rmdir /usr/share/codam
fi
