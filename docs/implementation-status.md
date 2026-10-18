# Complete-management implementation status

The current release uses the simplified gaming/streaming layout in README. It uses Node.js 24 LTS and discord.js v14, adds no npm dependencies or paid hosting, and retains 31 slash commands. Setup creates missing resources, previews renames/moves, preserves every existing overwrite, and offers five zero-permission public role toggles. Staff-role assignments, destructive repair options, welcome-channel creation and Disagree were removed.

## Phase-by-phase evidence

| Phase | Code delivered | Automated validation | Live verification |
| --- | --- | --- | --- |
| 1 — Foundation | Existing config validation, safe logs, command routing, CI; explicit opt-in for privileged community intents; graceful worker/database shutdown | Existing foundation/config/permission regressions plus real-client intent/shutdown tests | Configure the portal and `.env`; verify `/ping` and command visibility. |
| 2 — Setup | Simple six-category layout, same-actor preview/confirmation, zero-permission roles, five public toggle buttons, missing resource creation, reviewed rename/move without permission edits; no staff assignments or deletion | No-mutation previews, stale confirmation rejection, migration preserving all old overwrites/data, zero privilege grants, duplicate prevention, interrupted recovery, public role toggles and private staff | Compare every old overwrite and review new-resource permissions before confirmation. |
| 3 — Announcements | Staff announcements, durable schedules/list/cancel; legacy welcome service retained only for explicit opt-in and disabled by setup | Mention restrictions, pending screening, author revocation, scheduled retries; no welcome-channel creation | Test a scheduled post. Welcome/goodbye should remain disabled after setup. |
| 4 — XP | Meaningful-message eligibility/cooldowns, rank/leaderboard, levels/rewards, administrator adjustment, persistent reconciliation jobs | Spam/repetition/private-channel exclusions, cooldowns, reward thresholds/removal/safety, job generations, failed adjustment recovery | Test participation and reward hierarchy with ordinary accounts. |
| 5 — Tickets | Private category buttons and commands, per-member open-ticket mapping, rate limits, close/read-only archive, metadata-only staff logs | Request deduplication, privacy, denied closure, retained archives, renamed topic recovery, unexpected visibility refusal | Verify access using requester, unrelated verified member, and staff accounts. |
| 6 — Moderation | Warnings/cases, timeout/kick/ban, protected cleanup, anti-spam, safe private logs | Permission/hierarchy/owner protection, persistent warnings/cases, spam XP removal, protected message preservation, private-log refusal | Exercise destructive moderation only on disposable test accounts/messages. |
| 7 — Streaming/polls/events | Provider configuration/adapters, persistent item IDs, five-minute checks, YouTube baseline/catch-up, polls/votes/results, native events with text announcements | Mock HTTP token reuse, deduplication/restart checks, multi-upload ordering, removal races, missing credentials, poll closing, duplicate event recovery | Authenticate with your own Twitch/YouTube credentials and test live delivery. |
| 8 — Integration | SQLite storage, durable deliveries/jobs, role/privacy checks, rules logo and message recovery, simple migration checklist | ESLint and the complete Node test suite; 31 serialized command definitions; setup and major services exercised together using a Discord fixture | Actual Discord API behavior, provider authentication, permissions and continuous hosting remain to be checked. |

The automated suite uses real SQLite databases and a controlled Discord fixture. It does not use a real bot token, call Discord mutations, or authenticate with streaming providers. A hosted CI run is separate from local checks. No live server changes were performed during implementation.

## Credential audit

A targeted scan checked **7 reachable fetched Git commits, 50 unique historical blobs, and 53 current working-tree files** before the release commit. No matches were found for the Discord/GitHub/API/AWS token formats or private-key headers checked. No secret values were printed. The scan covers recognized patterns and fetched reachable history, not deleted/unfetched refs or every possible credential format.

The previously posted Discord token was exposed in chat independently of Git. Reset it unless it has already been rotated. Only variable names/presence were inspected in the current environment; the required Discord and optional streaming variables were missing, so no authenticated live test was attempted.

## Deployment prerequisites

1. Read the [README](../README.md), review the permission list, enable Server Members and Message Content in the Developer Portal, and set `ENABLE_COMMUNITY=true` locally.
2. Store Discord credentials in `.env`/secure host settings. Add Twitch/YouTube credentials only if using those providers. Never send their values in chat.
3. Register commands intentionally, run one continuously hosted process, then follow the [complete acceptance checklist](complete-testing.md).
4. Preview `/setup-server`, read its private full JSON plan, and confirm the same options only when you intend to apply its live changes.
5. Back up both SQLite state and existing `rules.json` while stopped. Sleeping Codespaces are not continuously running hosts.

The app does not automatically delete server resources or grant Administrator. Explicit staff moderation commands can delete eligible messages, kick, or ban only after their permission/hierarchy checks; these are separate from setup.
