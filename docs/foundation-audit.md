# Foundation review — Phase 1 of the expanded management roadmap

This review starts from `main` at `a577408`, after the foundation and rules pull requests were merged. The existing rules release remains in place. This phase prepares that code for the larger server-management roadmap; it does not implement the remaining systems or change the live Discord server.

## What exists and what is missing

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Foundation | Node.js 24 LTS, discord.js v14, commands/events/services/configuration, environment variables, guild slash-command registration, safe logs, shutdown handling, tests | Continue extending this structure in later phases. |
| Rules and verification | `/rules`, administrator-only `/setup-rules`, exact approved text, preview/confirmation, rules channel, agreement button, Verified role, permission checks, duplicate protection | Integrate these services into the future `/setup-server` flow without publishing another panel. |
| Persistence | Atomic JSON rules settings in `data/rules.json`, per-guild queues, recovery guidance | Add a shared database layer for XP, tickets, moderation cases, scheduling, polls, and notification state when those phases are built. |
| Full server setup | Rules setup only | `/setup-server`, `/setup-status`, full channel/category layout, safe combined preview and confirmation. |
| Roles and channels | Safe Verified role and rules channel only | `/setup-roles`, `/role-panel`, `/setup-channels`, `/channel-status`, owner-confirmed user-ID mapping, nonprivileged self-assignable roles, private staff layout, text accessibility channels. |
| Welcome and announcements | No implementation | Welcome/goodbye events, `/announce`, `/schedule-announcement`, durable scheduled delivery. |
| XP and levels | No implementation | `/rank`, `/leaderboard`, `/level-rewards`, `/xp-admin`, cooldowns, reward roles, persistent XP. |
| Support tickets | No implementation | Panels, `/ticket`, `/close-ticket`, private access, archiving, staff logs, duplicate prevention. References to support tickets in the approved rules are policy text, not a working ticket feature. |
| Moderation | No implementation | Warning/case storage, `/warn`, `/warnings`, `/timeout`, `/kick`, `/ban`, `/clear`, hierarchy checks, anti-spam. |
| Streaming | No implementation | Provider configuration, Twitch/YouTube polling, deduplication, secure credentials, provider rate limits. |
| Polls and events | No implementation | `/poll`, `/event`, persistent votes, closing times, results. |
| Hosting | A Node.js process must stay running; one process per rules data file | Choose a continuously running host before promising continuous monitoring. A stopped/deleted Codespace cannot keep the bot online. |

The bot still uses only the Guilds gateway intent. Future welcome/member events and meaningful message-based XP need a separate intent and permission review before their implementation. No privileged member role is assigned from a display name.

## Confirmed defects repaired

1. **Invalid Discord IDs passed validation.** Zero and leading-zero IDs were accepted, deferring the error until a later Discord request. Configuration now requires a nonzero, canonical 17–20 digit ID within Discord's unsigned 64-bit range. Errors identify the variable name without printing its value.
2. **Cached human administrator status could permit a verification bypass.** The rules planner trusted a cached member's Administrator flag when accepting a member-specific View Channel grant. Without the privileged Guild Members intent, role removal can leave that snapshot stale. The planner now refuses such human member grants. The server owner, current administrator-role grants, Verified, and bot identities retain their documented treatment. Current administrators already bypass channel restrictions and do not need a redundant member-specific grant.

Both defects were reproduced with failing regression tests before the fixes. The repair changes validation and planning behavior; it does not edit existing Discord overwrites automatically. If a preview reports an individual visibility grant, an administrator must review that grant before confirming setup.

## Foundation additions

- `npm run check:config` validates the required environment variables and ID formats without contacting Discord or printing their values. A successful result does not prove the token works or that channel permissions are correct.
- GitHub Actions runs the lockfile installation, linting, automated tests, and command preview on pull requests and pushes to `main`. The job uses Node.js 24, read-only repository permissions, pinned official actions, and no Discord credentials. It never starts the bot or deploys commands.
- This report records the feature gaps and manual verification steps so later phases can build on the existing rules implementation.

## Credential history audit

The audit fetched the repository's available branches and tags, then checked **5 reachable commits and 39 unique file blobs** across **8 local/remote refs** before these foundation changes. It inspected file contents and commit metadata for Discord tokens, common GitHub/API/AWS keys, private-key headers, and nonempty assignments to known credential variable names. Only object/path/type metadata could be printed for a finding; no credential values were printed.

**Result:** no matches for those credential patterns, and no tracked `.env` history was found. This targeted scan covers the fetched reachable history and recognized formats; deleted/unfetched refs and other secret formats are outside that result.

The Discord token posted earlier in chat was exposed independently of Git history. **Reset it in the Discord Developer Portal unless that reset has already been completed.** Use the replacement only in a local ignored `.env` or secure environment settings. The audit does not test whether a token was revoked.

## Validation and how to verify in Codespaces

Before the changes, all **68** existing tests and ESLint passed. After the repairs, all **72** tests pass, including the existing rules safety tests and the new configuration-check and stale-member-cache regressions. ESLint and the offline command preview pass too. The workflow YAML was parsed and checked locally; a hosted GitHub Actions run is a separate result.

From the project directory in Codespaces, use Node.js 24 and run:

```sh
nvm install
nvm use
npm ci
npm run check
npm test
npm run commands:preview
```

The command preview must contain exactly `ping`, `rules`, and `setup-rules`. `/setup-rules` must have Administrator as its default member permission. The planned `/setup-server` and later commands are not implemented yet.

After securely configuring `.env`, run:

```sh
npm run check:config
npm start
```

Then verify these actions yourself in Discord:

- [ ] `/ping` replies with Pong and latency.
- [ ] `/rules` privately shows the approved text unchanged.
- [ ] An ordinary member cannot run `/setup-rules`.
- [ ] `/setup-rules` without confirmation shows an administrator-only preview without changing server resources.
- [ ] A human member-specific visibility grant is reported as a conflict, even if that member has an old cached administrator snapshot.

These foundation changes do not alter command definitions, so a working installation does not need redeployment for this branch. For a new installation, explicitly run `npm run deploy:commands` after reviewing the registration instructions in the README. Registration replaces this application's guild command list.

Confirmed rules setup modifies live channel visibility. Perform it only when you intend to apply those changes, after reviewing the preview and following the [rules verification checklist](rules-testing.md). No live Discord command, role assignment, or permission mutation was executed during this foundation review. GitHub Actions execution and real Discord behavior must be assessed separately from the local checks.

## Next phase

The next phase is the safe combined server setup: `/setup-server`, `/setup-status`, the requested categories/channels, and safe role creation, reusing the existing rules services. Announcement, XP, ticket, moderation, streaming, poll, and event functionality remain in their later phases. A combined setup must report unavailable services accurately rather than publishing nonfunctional panels.
