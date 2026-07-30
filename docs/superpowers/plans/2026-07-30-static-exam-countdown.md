# Static Exam Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the browser-only static preview show a 30-second exam-start countdown.

**Architecture:** Keep the behavior in `static/debug.js`, which is loaded only when the production bundle is unavailable. The existing screen switcher starts and clears one interval; it updates the existing timer element and arrow button.

**Tech Stack:** Browser DOM APIs and plain JavaScript.

## Global Constraints

- Modify only `static/debug.js`; do not alter the bundled client or installed greeter behavior.
- Use the existing `exam-mode-start-timer` and `exam-mode-start-button` elements.
- The demo duration is exactly 30 seconds and resets whenever Exam mode is selected.

---

### Task 1: Add the preview countdown

**Files:**
- Modify: `static/debug.js:1-115`
- Test: Manual browser check of `static/index.html`

**Interfaces:**
- Consumes: `switchScreen(screenId)`, `#exam-mode-start-timer`, and `#exam-mode-start-button`.
- Produces: `startExamCountdown()` and `clearExamCountdown()` used only by `switchScreen`.

- [ ] **Step 1: Establish the current failure**

Open `static/index.html`, select **Exam mode**, and verify the text remains `Click the arrow below to start your exam.` while the arrow remains enabled.

- [ ] **Step 2: Add the minimal countdown state and helpers**

```js
let examCountdownInterval = null;

function clearExamCountdown() {
	clearInterval(examCountdownInterval);
	examCountdownInterval = null;
}

function startExamCountdown() {
	clearExamCountdown();
	let secondsRemaining = 30;
	examStartButton.disabled = true;
	examStartTimer.innerText = `You may start your exam in ${secondsRemaining} seconds.`;
	examCountdownInterval = setInterval(() => {
		secondsRemaining -= 1;
		if (secondsRemaining === 0) {
			clearExamCountdown();
			examStartTimer.innerText = 'Click the arrow below to start your exam.';
			examStartButton.disabled = false;
			return;
		}
		examStartTimer.innerText = `You may start your exam in ${secondsRemaining} seconds.`;
	}, 1000);
}
```

Use `examStartTimer.innerText = \`You may start your exam in ${secondsRemaining} seconds.\`;`. When it reaches zero, clear the interval, restore `Click the arrow below to start your exam.`, and set `examStartButton.disabled = false`.

- [ ] **Step 3: Connect it to screen changes**

```js
if (screenId === 'exam-form') {
	startExamCountdown();
} else {
	clearExamCountdown();
}
```

Place this in `switchScreen` after selecting the form. Set `examStartButton.disabled = true` before rendering the first countdown value.

- [ ] **Step 4: Verify the preview behavior**

Open `static/index.html`, select **Exam mode**, and confirm: the arrow is disabled immediately; the text starts at 30 seconds and decrements once per second; the arrow enables after 30 seconds; selecting Login and returning to Exam restarts at 30 seconds without duplicate updates.

- [ ] **Step 5: Verify production scope and commit**

Run:

```bash
npm run build
git diff --check
git add static/debug.js
git commit -m "Add static exam countdown preview"
```

Expected: TypeScript build succeeds, whitespace check succeeds, and only the preview script changes for this feature.
