# Static Exam Countdown Preview

## Scope

Add a browser-preview-only 30-second exam countdown in `static/debug.js`.

## Behavior

- Selecting **Exam mode** disables the existing arrow button and starts at 30 seconds.
- The existing timer text updates once each second.
- At zero, the arrow is enabled and the normal start message is restored.
- Switching away from exam mode clears the active interval; selecting it again starts a fresh demo.

## Boundaries

Only `static/debug.js` changes. The bundled client and installed greeter behavior are unchanged.

## Verification

Open `static/index.html`, select **Exam mode**, and confirm the visible countdown reaches zero and enables the arrow.
