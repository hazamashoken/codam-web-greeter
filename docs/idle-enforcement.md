# Idle Enforcement Operator Guide

## Runtime layout

The hardened idle-enforcement path stores root-owned runtime state in:

- `/run/codam-web-greeter/lock/`
- `/run/codam-web-greeter/offenses/`
- `/run/codam-web-greeter/session-cache/`

Persistent configuration lives in `/etc/codam-web-greeter/idler.conf`.

## Default policy

- Idle or locked timeout: `42m`
- Hard session cap: `6h`
- Offense window: `1800s`
- First suspicious offense: kill suspicious processes only
- Second suspicious offense in window: terminate session
- Third suspicious offense in window: terminate user
- LightDM restart: disabled by default

## Journald inspection

Inspect current idler logs:

```bash
journalctl -t codam-web-greeter-idler -n 100 --no-pager
```

Common fields:

- `action=detect-suspicious`
- `action=kill-pids`
- `action=terminate-session`
- `action=terminate-user`
- `reason=suspicious_process`
- `reason=locked_too_long`
- `reason=idle_timeout`
- `reason=hard_session_cap`

Each structured log entry includes the user, uid, session, seat, offense count, idle milliseconds, lock milliseconds, session age, and suspicious PID list when available.

## Offense state

Per-user offense files live in `/run/codam-web-greeter/offenses/<user>.state`.

Example:

```bash
cat /run/codam-web-greeter/offenses/alice.state
```

Fields:

- `latest_offense_ts`
- `offense_count`
- `last_reason`
- `last_pids`
- `last_commands`

## Auditd evidence

If `ENABLE_AUDITD=1` and `auditd` tooling is available at install time, the installer writes `/etc/audit/rules.d/codam-web-greeter-anti-idle.rules` for these executables when present:

- `/usr/bin/xdotool`
- `/usr/bin/ydotool`
- `/usr/bin/xte`
- `/usr/bin/dbus-send`
- `/usr/bin/gdbus`

Inspect matching audit events:

```bash
ausearch -k codam-web-greeter-anti-idle
```

## Incident report template

```text
Timestamp:
Host:
User:
UID:
Session ID:
Seat:
Reason:
Action taken:
Offense count:
Suspicious PIDs:
Suspicious commands:
Idle ms:
Lock ms:
Session age sec:
Relevant journalctl excerpt:
Relevant ausearch excerpt:
```
