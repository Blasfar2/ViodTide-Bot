# Complete VOIDTIDE acceptance checklist

Unchecked boxes are manual tests, not claims of live verification. Use a disposable Discord server and separate administrator/member accounts. The automated suite mocks Discord/provider responses; it does not log into your server.

## Installation and initial permissions

- [ ] Check out the complete-management branch, use Node.js 24 LTS, install with `npm ci`, and configure an ignored `.env`.
- [ ] Reset the token previously exposed in chat if it has not already been reset. Never share the replacement.
- [ ] Enable Server Members and Message Content in the application Bot settings, then set `ENABLE_COMMUNITY=true` locally. Leave Presence disabled.
- [ ] Grant only the full permission list in README. Do not grant Administrator to the bot.
- [ ] Move the bot role above assignable/reward/staff roles and moderation targets.
- [ ] Run `npm run check`, `npm test`, `npm run commands:preview`, and `npm run check:config`.
- [ ] Review the guild-command replacement scope, register commands intentionally, start one bot process, and verify `/ping`.

## Setup, channels, roles, and verification

- [ ] Record the existing categories, channels, role memberships, and permission overwrites. Keep an administrator account available for recovery.
- [ ] An ordinary member cannot run setup/status/XP-admin/provider configuration commands, including if command visibility has been customized.
- [ ] `/setup-server` is a private preview with an attached complete JSON plan. No Discord resource or permission changes occur yet.
- [ ] Read every nonprivileged role, channel/category create, rename and move in that plan. Check the permissions shown for newly created resources.
- [ ] Confirming without a matching same-admin preview, after ten minutes/restart, or after role/channel changes is refused.
- [ ] No staff-account selection or deletion option is offered. Existing role permissions/memberships and channel overwrites are unchanged; new selectable roles have zero permissions.
- [ ] Confirm the reviewed plan. Check `/setup-status` for completion and missing resources. Unsupported pre-existing privileges, duplicates, public staff channels, or visibility bypasses are reported for manual review.
- [ ] Run setup preview/confirmation twice, including after restart. Role, channel, panel IDs remain stable; no duplicate resources appear.
- [ ] Verify the six categories, thirteen text channels and three voice rooms in README. No welcome/goodbye or AFK channels are created. Existing unrelated resources are not deleted or renamed.
- [ ] A new ordinary member can read rules and the public five-role panel. Existing verification gates remain unchanged; staff and private tickets remain hidden.
- [ ] Pending Discord membership screening is not bypassed by an automatic newcomer role. Complete screening before verification.
- [ ] Rules text matches the approved text exactly. Double-clicking verification safely returns success/already-verified, assigns only Verified, and removes a safe Newcomer label if present.
- [ ] Agree still assigns Verified and unlocks any pre-existing Verified gates; new public resources stay public. Disagree is absent.
- [ ] `/setup-roles` and `/setup-channels` have matching preview/confirmation behavior; neither pretends full service setup is finished.
- [ ] Refresh rules with `/auto-rule` after simple setup and verify that no channel permission overwrites are edited.

## Welcome, announcements, and scheduling

- [ ] Join and leave using a test account. Automatic welcome/goodbye messages remain disabled after setup and no destination is created.
- [ ] Duplicate gateway events do not create duplicate messages. A stopped process does not claim it observed joins/leaves while offline.
- [ ] If explicitly testing the legacy `/welcome-config`, choose an already existing public channel manually. No channel should be created by the command; disable it afterward.
- [ ] Staff `/announce` supports title, description, HTTPS image, and optional link. Ordinary members are refused.
- [ ] Content containing `@everyone`/role mentions does not mass ping. Only the intended welcome member mention is allowed.
- [ ] Schedule a near-future announcement with an explicit timezone. List and cancel another pending job. Invalid/missing timezones and invalid dates are refused.
- [ ] Stop/restart before a scheduled job; it resumes when overdue. Remove the author's staff permission before delivery; the job must not post.
- [ ] Temporarily remove send permission: `/jobs` reports retries/failure, the bot remains running, and restoring permission permits a controlled retry without duplicate delivery.

## XP and rewards

- [ ] Verified human participation in configured public conversation channels earns XP, no more than once a minute.
- [ ] Short/repeated text, bots, webhooks, private tickets/staff channels, and detected spam do not earn XP. A detected burst removes its recent award.
- [ ] `/rank`, `/leaderboard`, and `/level-rewards` agree with stored values and level thresholds.
- [ ] `/xp-admin` is administrator-only; test totals around levels 5, 10, 20, 30, and 50. Rewards are added/removed correctly, with no elevated role assignment.
- [ ] Reorder/elevate a reward role temporarily. Assignment fails safely and records job failure; it must never grant staff powers.
- [ ] Restart the bot. XP/cooldowns persist, and pending level notices/reward reconciliation resume.

## Tickets and self-assigned roles

- [ ] Both `/ticket` and each panel category work. Two rapid requests by one member reuse one open private channel.
- [ ] Requester and authorized staff can read/write the ticket. Another verified member cannot discover/read it.
- [ ] A nonrequester/nonstaff cannot close a ticket. Requester/staff can archive it, retaining private messages and requester read-only access.
- [ ] Ticket logs contain IDs/category/status only in the private ticket-log channel. No transcript is posted publicly.
- [ ] Reopening/recovering a ticket with an unrelated visibility grant is refused until privacy is fixed.
- [ ] The three-new-tickets-per-hour limit works. Externally deleted tickets retain an audit record and permit a new request without silently recreating old content.
- [ ] Role buttons toggle only Streamer/VIP. Unverified members and copied/stale panels are refused.
- [ ] Giving a cosmetic/reward role any server privilege or channel grant disables its automatic assignment.

## Moderation

- [ ] Staff can warn/read warnings, timeout, kick, ban, and clear eligible messages; unauthorized members are refused at runtime.
- [ ] Owner, administrators, actor/bot themselves, and equal/higher-role targets are protected.
- [ ] Cases/warnings persist across restart; audit actor/target IDs and reasons are correct. Uncertain outcomes are marked for staff review, never automatically replayed.
- [ ] `/clear` preserves pinned, old, bot, owner, administrator, and protected higher-role messages. Only eligible recent messages are deleted by this explicit command.
- [ ] Anti-spam detects a six-message/eight-second test burst, excludes staff, applies at most one short timeout per cooldown, and stores a case without message content.
- [ ] Make the log channel public in a test server: confidential logging must stop, not leak into that channel.

## Streaming, polls, and events

- [ ] Configure provider credentials securely and add accounts using `/stream-config`. List shows only presence/status, never secret values.
- [ ] Confirm Twitch authentication and a live stream on your own account. One stream ID generates one notification, including after restart.
- [ ] Confirm YouTube's first check establishes a baseline. A later upload is announced once; several unseen uploads catch up oldest first (at most 50 items per check).
- [ ] Provider failure/quota responses set an error state without tight retry loops. Removing an account during polling does not restore it later.
- [ ] Confirm no claim of continuous monitoring while the bot/host is stopped. Network/provider credentials alone do not create a 24/7 host.
- [ ] `/poll` accepts 2–5 distinct choices. One member has one persisted choice; voting again changes it. Noncanonical message IDs, invalid choices, and late votes are refused.
- [ ] Restart before a poll closes. The job persists, results are posted in the existing message, and buttons are removed.
- [ ] `/event` validates start/end, checks Manage Events, creates one native Discord event, and publishes textual details in events/announcements without duplicates.

## Final audit and rollout

- [ ] Review every actual staff and ticket overwrite, including administrator exceptions and unrelated legacy roles.
- [ ] Back up the stopped bot's entire `data/` directory and test restoration into a single-process development deployment.
- [ ] Confirm a partially failed setup can be previewed/retried without resetting data or deleting resources.
- [ ] Review failed jobs, provider error states, logs, dependency checks, and secret handling. Do not paste logs containing credentials.
- [ ] Record actual live test results and announce verification changes before rollout. Keep the configured bot process running on your chosen host.
