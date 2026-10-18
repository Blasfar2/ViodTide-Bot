# Simple gaming/streaming setup acceptance checklist

Use a test server, a backup of all `data/`, and separate administrator/member accounts. Automated tests mock Discord and do not establish live API behavior.

- [ ] Deploy updated commands. `/setup-server` and compatibility `/auto-fix` expose `confirm` only, with Administrator defaults and runtime checks. Old deletion/member-assignment options are rejected.
- [ ] Preview makes no resource, permission, member-role or persistent configuration changes. Read every proposed create, rename and move in the private JSON attachment.
- [ ] Confirmation without a matching preview, with another account/command, after role/channel/settings changes, after ten minutes or after restart is rejected.
- [ ] Fresh setup creates exactly the requested six categories, thirteen text channels and three voice rooms, with no welcome/goodbye channels or staff roles.
- [ ] Confirmed setup does not call permission-overwrite edits on existing channels. Compare every old overwrite, including channels moved with `lockPermissions:false`.
- [ ] Existing channel histories and unrelated channels stay intact; no channel is deleted. Repeated setup/restart produces no duplicate resources or panels.
- [ ] An existing wrong type, ambiguous duplicate, unsafe self-selectable role or public staff area fails for manual staff review, without automatic deletion or permission changes.
- [ ] New staff resources are private to the bot and roles already holding staff permissions. No role grants privileged access to a new member automatically.
- [ ] 🎭・choose-roles is publicly readable. An ordinary member without Verified can toggle Gamer, Live Notification, Video Notification, Sign Language and Events on/off using the exact five emoji buttons.
- [ ] Completing Discord's membership screening is required before any role toggle. Elevating a selectable role, giving it channel grants or moving it above the bot makes toggles fail safely.
- [ ] Stale/copied role panels and invented privileged-role IDs are refused. Losing Manage Roles produces safe guidance without a role change.
- [ ] If the legacy role channel was private, it remains unchanged; the new named public channel is used and the old bot panel is retired. Repeating setup still creates only one current public panel.
- [ ] No member is assigned Founder, Co-Founder, Moderator, Administrator or Manage Roles by setup. Existing privileged role permissions and memberships are unchanged.
- [ ] Existing XP, reward roles, warnings, tickets, scheduled jobs, provider checkpoints and private log destinations survive migration.
- [ ] Open tickets remain accessible to their requester/staff and hidden from others; new tickets work after support-category reorganization. Closing archives rather than deleting messages.
- [ ] Rules retain their approved wording and logo. Existing Verified gates remain unchanged, and later `/auto-rule` refreshes do not edit overwrites after simple setup.
- [ ] The final rules message has only green ✅ I Agree. Previously posted red buttons are removed when setup refreshes the current saved panel; clicking any stale red copy gives private retirement guidance.
- [ ] `/auto-rule logo:` accepts PNG/JPEG/WebP, including Discord ephemeral attachments. Preview/confirm uploads the original logo as the bot, then publishes the rules and agreement in order. Restart/update reuses `data/rules-assets/`.
- [ ] Repeated Agree is idempotent. Bots, screening-pending members, elevated/deleted Verified roles and outdated panels are rejected safely.
- [ ] Stop the bot: rules remain readable, while button actions stop. Restart restores handling; see [offline rules](offline-rules.md).

Primary regressions: `tests/auto-management.test.js`, `tests/community-management.test.js`, `tests/community-recovery.test.js`, `tests/rules-sequence.test.js`, and the rules/foundation suites.
