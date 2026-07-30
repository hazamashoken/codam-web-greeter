# Passwordless Exam Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the fixed exam account from the enabled exam button without visible credentials.

**Architecture:** Remove the exam-only fields from HTML and `UIExamModeElements`. Keep the existing form submit event, but have it call the fixed-account authentication only if exam mode is active and the countdown has enabled the button.

**Tech Stack:** TypeScript and static HTML.

## Global Constraints

- Keep `ExamModeUI.EXAM_USERNAME` and `ExamModeUI.EXAM_PASSWORD` unchanged.
- Do not change regular login or lock-screen inputs.
- Preserve the existing countdown gate by rejecting submits while `examStartButton.disabled` is true.

---

### Task 1: Remove exam credentials from the UI and submit flow

**Files:**
- Modify: `static/index.html:51-60`
- Modify: `client/uis/screen.ts:20-30`
- Modify: `client/uis/screens/examscreen.ts:45-65,134-157,250-285`
- Test: `npm run build`

**Interfaces:**
- Consumes: `UIExamModeElements.examStartButton`, `ExamModeUI.EXAM_USERNAME`, and `ExamModeUI.EXAM_PASSWORD`.
- Produces: a submit handler that calls `Authenticator.login(username, password)` only after the button is enabled.

- [ ] **Step 1: Establish the current behavior**

Confirm `static/index.html` contains `#exam-login` and `#exam-password`, and `ExamModeUI._initForm()` rejects submission unless both values are `exam`.

- [ ] **Step 2: Remove the input contract**

Delete these HTML elements:

```html
<input type="text" name="login" id="exam-login" placeholder="Enter the login" maxlength="32" />
<input type="password" name="password" id="exam-password" placeholder="Enter the password" maxlength="128" />
```

Delete `loginInput` and `passwordInput` from `UIExamModeElements`, their DOM lookups, the input listeners, and `_wigglePasswordInput` from `ExamModeUI`.

- [ ] **Step 3: Make the enabled button submit directly**

```ts
form.form.addEventListener("submit", (event: Event) => {
  event.preventDefault();
  if (this._examMode && !form.examStartButton.disabled) {
    this._auth.login(ExamModeUI.EXAM_USERNAME, ExamModeUI.EXAM_PASSWORD);
  }
});
```

Change `_getInputToFocusOn()` to return `form.examStartButton` only when it is enabled; otherwise return `null`. Remove its duplicate focus call from `_enableOrDisableSubmitButton()`.

- [ ] **Step 4: Verify**

Run:

```bash
npm run build
npm run bundle
git diff --check
```

Expected: the TypeScript client and bundle compile; no whitespace errors; there are no references to `exam-login`, `exam-password`, `loginInput`, or `passwordInput` in exam-mode code.

- [ ] **Step 5: Commit**

```bash
git add static/index.html client/uis/screen.ts client/uis/screens/examscreen.ts
git commit -m "Restore passwordless exam start"
```
