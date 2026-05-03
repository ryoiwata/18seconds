// Shared diagnostic-session hard-cutoff threshold.
//
// Two call sites must use this value in lockstep so the 15-minute
// timed-diagnostic contract stays consistent (see
// docs/plans/phase-3-polish-practice-surface-features.md §3.1):
//
//   1. Server-side enforcement in `submitAttempt`
//      (`src/server/sessions/submit.ts`) — the source of truth. After
//      writing the `attempts` row, if the session is a diagnostic AND
//      `Date.now() - started_at_ms >= DIAGNOSTIC_SESSION_DURATION_MS`,
//      `submitAttempt` returns `{ nextItem: undefined }` WITHOUT
//      consulting the selection engine. The user's last submit always
//      counts (option-(a) UX from §3.1).
//
//   2. Client-side cosmetic indicator (commit 4) — the FocusShell's
//      diagnostic content component imports this constant to wire the
//      session-timer bar's `sessionDurationMs` and to drive the
//      cosmetic "last question" indicator when the elapsed clock
//      crosses 15:00. The client-side comparison is purely visual; the
//      server's `nextItem === undefined` is what actually ends the
//      session.
//
// This file exports a numeric constant only — no I/O, no DB access, no
// logger. That makes it explicitly safe to import from client
// components alongside its server-side use site, sidestepping the
// usual "server-only module" boundary concerns.
//
// Mirrors the shape of `src/server/sessions/abandon-threshold.ts`
// (Phase 3 Commit C). Tighten or loosen the threshold here only —
// both consumers pick up the new value automatically.

const DIAGNOSTIC_SESSION_DURATION_MS = 15 * 60_000

export { DIAGNOSTIC_SESSION_DURATION_MS }
