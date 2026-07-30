# Passwordless Exam Start

## Scope

Restore the upstream passwordless exam-start interaction.

## Behavior

- The exam screen has no login or password fields.
- Submitting the enabled start button authenticates with the existing fixed `exam` account credentials.
- The existing countdown remains the only start-time gate; submission while its button is disabled does nothing.
- When the button becomes enabled, it receives focus.

## Boundaries

Update only the exam-screen HTML and TypeScript interfaces/behavior. Do not change the credentials, server API, or regular login/lock screens.

## Verification

The client bundle builds successfully. In an exam-mode greeter session, the button is disabled before `begin_at`, then starts the fixed `exam` session after `begin_at` without visible credential inputs.
