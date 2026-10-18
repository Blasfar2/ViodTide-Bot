# VOIDTIDE Bot

One JavaScript community bot using **discord.js v14**, **Node.js 24 LTS**, and persistent SQLite storage. The implementation includes server setup, rules and verification, announcements, XP/rewards, private support tickets, roles, welcome/goodbye messages, moderation, streaming notifications, polls, and Discord events.

Code and automated tests are provided. Real Discord permissions, provider authentication, and hosting must still be verified with your own installation. No live server changes were made while developing this branch.

## 1. Install in Codespaces

Use the branch containing this release, or merge its pull request and update `main`. Stop any older bot process before starting another copy.

```sh
nvm install
nvm use
npm ci
cp -n .env.example .env
```

Fill in `.env` locally using your editor:

- `DISCORD_TOKEN`: your bot token. **Reset the token previously shared in chat if you have not already done so.**
- `DISCORD_CLIENT_ID`: Application ID from the Discord Developer Portal.
- `DISCORD_GUILD_ID`: server ID copied with Discord Developer Mode enabled.
- `ENABLE_COMMUNITY=true`: enables the full community services.

Never paste credentials into chat, logs, source code, screenshots, or Git. `.env` and `data/` are ignored. The earlier [foundation audit](docs/foundation-audit.md) records the targeted Git-history scan and its scope.

## 2. Enable the required intents

In the [Discord Developer Portal](https://discord.com/developers/applications), select your application and open **Bot**:

1. Enable **Server Members Intent** for welcome/goodbye and fresh membership events.
2. Enable **Message Content Intent** for meaningful XP and anti-spam.
3. Leave **Presence Intent** off; it is unnecessary.
4. Set `ENABLE_COMMUNITY=true` in your local `.env` and restart the process.

For larger/verified applications Discord may require approval for privileged intents. If the application is not approved, keep `ENABLE_COMMUNITY=false`; the original `/ping`, `/rules`, and `/setup-rules` foundation remains available. New management commands explain that community services are disabled. Enabling the variable alone does not enable intents in the Developer Portal.

If command registration succeeds but `npm start` exits with a gateway error, check these intent switches first. Command registration uses Discord's HTTP API; the gateway separately checks permission to use privileged intents. A `4014` diagnostic means Discord rejected those intents. Save both switches for the same application as `DISCORD_CLIENT_ID`, then rerun `npm start`; command registration does not need to be repeated. If it still fails, share the sanitized error line, never your `.env` or token.

## 3. Invite permissions — read before setup

The full bot needs **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**, **Manage Channels**, **Manage Roles**, **Manage Messages**, **Moderate Members**, **Kick Members**, **Ban Members**, and **Manage Events**. It does **not** need Administrator.

Replace `YOUR_APPLICATION_ID` and open this Guild Install link:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1108370123798&integration_type=0&scope=bot%20applications.commands
```

Put the bot's highest role above the roles it must assign and the members it may moderate. Discord still protects the server owner, administrators, and equal/higher roles. Individual channel denies can prevent actions even when the guild-level permission exists.

Setup creates **VOIDTIDE Founder**, **Co-Founder**, and **Moderator** roles with Moderate Members, Kick Members, Ban Members, Manage Messages, and Manage Events. It never grants Administrator or Manage Roles to members. The other community/reward roles have zero server-wide privileges. Self-assignable Streamer and VIP roles are cosmetic; if either later receives server/channel permission grants, self-assignment stops.

Founder: Badr. Co-Founders: Yacin, Nisrine, Mehdi. **Names do not assign roles.** Only the server owner can choose their Discord accounts using the setup options, review their IDs, and confirm the same selection. Unselected staff roles remain unassigned. The actual managed bot role can be reused unchanged; the bot does not assign that managed role to humans.

## 4. Validate, register, and run

```sh
npm run check
npm test
npm run commands:preview
npm run check:config
npm run deploy:commands
npm start
```

`check`, `test`, and `commands:preview` work offline without credentials. `check:config` checks configuration formats and prints no values; it does not authenticate with Discord. `deploy:commands` **replaces this application's guild command list**, including removal of older commands absent from this project. It does not alter other apps or global commands. Run registration intentionally after updating command definitions, not on a timer.

Keep `npm start` running. Use `npm run dev` for automatic restarts during development, and Ctrl+C to stop. GitHub Actions runs lint/tests/preview with no Discord credentials; it never starts the bot or configures the server.

## 5. Preview and configure the server

Start in a disposable development server. Record existing channel overwrites and back up `data/` before changing a production server.

1. As an administrator, run **`/setup-server`**. It makes no Discord changes. Read the private summary and attached **complete JSON plan**, including existing channels that will be gated.
2. If you are the server owner and want team assignments, use the optional `badr`, `yacin`, `nisrine`, and `mehdi` account selectors. Review the selected IDs and intended staff powers.
3. Within ten minutes, run **`/setup-server confirm:true`** with exactly the same account selections. A role/channel change or process restart invalidates the preview.
4. Run **`/setup-status`** and test with a separate ordinary member account.

Confirmed full setup creates missing resources and reuses saved IDs/unique names. It does not delete resources, reset unrelated permissions, mass-verify members, or overwrite incompatible existing roles. Ambiguous names, unsafe staff visibility, conflicting role permissions, and unsupported access bypasses stop setup for manual review. Existing resources are not automatically moved to another category. The rules/welcome channel may be detached from a gated category so newcomers retain access.

**Visibility changes:** existing public community channels are gated behind Verified. Existing members without Verified must agree too. Rules and welcome remain public/read-only. Staff resources and ticket archives stay private. Administrators inherently bypass Discord overwrites. New public channels added later require another reviewed setup run. Never auto-assign unrelated visibility-bypass roles to newcomers.

Confirmed setup configures rules, ticket and role panels, welcome/goodbye, XP/rewards, announcements, and private logs. Streaming needs provider accounts and credentials separately. `/setup-roles` and `/setup-channels` also use preview/confirmation, but their narrower scopes only create the required resources; use `/setup-server` to activate the integrated services. The AFK voice channel is created; existing server-wide AFK/idle settings are preserved.

### Layout

| Category | Channels |
| --- | --- |
| START HERE | welcome, 📜・rules, announcements, choose-roles |
| COMMUNITY | general, **sign-language**, media, bot-commands, events |
| GAMING | gaming-chat, looking-for-group, leaderboard, level-rewards |
| VOIDTIDE STREAMS | live-now, clips, youtube, stream-schedule |
| SUPPORT | open-ticket, faq |
| VOICE | Gaming Room 1, Gaming Room 2, AFK |
| STAFF — private | staff-chat, mod-logs, ticket-logs, bot-admin |

Important rules, event details, schedules, and notices are available in text. Voice participation is optional. The sign-language channel welcomes Deaf, hard-of-hearing, and hearing members.

## Commands

| System | Commands and usage |
| --- | --- |
| Health | `/ping` |
| Setup | `/setup-server`, `/setup-roles`, `/setup-channels` — preview first, then `confirm:true`; `/setup-status`, `/channel-status` |
| Rules | `/rules`; `/setup-rules` with its own administrator preview/confirmation; **✅ I Agree** assigns Verified |
| Announcements | `/announce title description [image] [link]`; staff-only, no mass mentions |
| Scheduling | `/schedule-announcement create time title description [image] [link]`; `list`; `cancel id` |
| Levels | `/rank [member]`, `/leaderboard`, `/level-rewards`; `/xp-admin member xp` sets a total and reconciles reward roles |
| Tickets | `/ticket-panel`; `/ticket category`; `/close-ticket` inside a ticket; panel/close buttons |
| Roles | `/role-panel`; Streamer/VIP toggle buttons for verified members |
| Welcome | `/welcome-config enabled [channel]`; full setup enables welcome and goodbye messages |
| Moderation | `/warn member reason`, `/warnings member`, `/timeout member reason minutes`, `/kick member reason`, `/ban member reason`, `/clear count` |
| Streaming | `/stream-config add provider account channel`; `list`; `remove provider account` |
| Polls | `/poll question options closes` — 2–5 choices separated by `|` |
| Events | `/event title description start end location` — creates a native external Discord event and textual announcements |
| Job health | `/jobs` — staff-only view of durable job outcomes |

Schedules use ISO dates with a timezone, for example `2027-01-20T20:00:00Z`. The bot rejects ambiguous local timestamps and invalid calendar dates. Discord renders timestamps in each member's local timezone.

### XP and anti-spam

Verified human members earn **15 XP per eligible message**, at most once per minute, in the configured general/sign-language/media/gaming-chat/looking-for-group/clips/events channels. Messages need at least eight letters/numbers; immediate repeated content, bots, webhooks, tickets, staff channels, and spam do not earn XP. A detected spam burst removes its recent participation award.

Level is `floor(sqrt(XP / 100))`. Roles are awarded at levels **5, 10, 20, 30, 50**. Level notices and role reconciliation use durable jobs. Administrator XP reductions also remove no-longer-earned reward roles. Unsafe/reordered roles cause a visible failure rather than privilege escalation.

Anti-spam detects six messages in eight seconds, excludes staff, protects owner/admin/higher roles, and applies a 30-second timeout when Discord permissions allow it. It records a moderation case and does not log message content. It is a conservative burst limiter, not a complete abuse classifier.

### Tickets, moderation, and privacy

A member has one open ticket at a time and at most three new tickets per hour. Categories are General Help, Report Member, Technical Help, and Partnership. Only the requester, designated staff, and the bot receive explicit access; Discord administrators inherently retain access. Closing makes the ticket read-only for its requester and preserves all messages privately. No transcript is copied into public channels. Ticket logs contain IDs/category/status only.

Moderation commands check the acting member's current permissions, target hierarchy, and the bot's permissions. The owner, administrators, yourself, and this bot are protected. Warnings/cases persist. Uncertain moderation outcomes are marked for staff review rather than automatically replayed. `/clear` preserves pinned, old, bot, owner, and protected higher-role messages. Moderation/log channels are checked for privacy before confidential details are posted.

## Streaming setup

Add optional credentials only to your local `.env` or secure host environment:

```dotenv
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
YOUTUBE_API_KEY=
```

- **Twitch:** create your application in the Twitch developer console. This bot uses an app client-credentials token in memory and the Helix streams endpoint. Configure the lowercase Twitch login with `/stream-config add provider:Twitch account:... channel:...`.
- **YouTube:** enable YouTube Data API v3 for your API key. Configure the **24-character channel ID beginning `UC`**, not a handle or arbitrary URL.
- Polling occurs every **five minutes** while the bot runs, up to 20 accounts per guild. Provider failures respect this polling cooldown and report an error state. `/stream-config list` shows credential presence, not values or guaranteed authentication.
- YouTube's first check stores a baseline without flooding old uploads. Subsequent checks catch up at most the latest 50 playlist items, oldest unseen upload first. Twitch can announce an already-live stream on its first check. Saved provider item IDs and delivery markers prevent repeated notifications.
- Outbound HTTPS is needed for `id.twitch.tv`, `api.twitch.tv`, and `www.googleapis.com`. Bot login also needs Discord HTTPS and secure gateway WebSockets. No live provider calls were made during offline testing.

**There is no 24/7 monitoring guarantee.** A sleeping/stopped/deleted Codespace stops polling and gateway events. A continuously running host is required for continuous operation; no Replit or paid service is introduced by this project.

## Persistence, recovery, and hosting

Keep **one bot process per data directory**. SQLite persists configuration, XP/cooldowns, ticket records, moderation cases/warnings, jobs, stream checkpoints, polls, votes, and delivery IDs in `data/community.sqlite`. Existing verification state remains in `data/rules.json` and is reused rather than discarded. Both stores must be preserved.

Stop the bot before copying/backing up the entire `data/` directory, including SQLite WAL/SHM files if present. A database handle closes on graceful shutdown. A deleted Codespace loses local runtime data unless you have copied it to persistent storage. Never commit runtime databases or credentials.

Jobs are resumed after restart, including expired in-progress leases. Failed deliveries retry with exponential backoff, then become `failed` after five attempts; inspect `/jobs`, permissions, and private logs before intervention. `/schedule-announcement cancel` cancels pending/retry jobs; it cannot unsend an already running/completed post. Announcements recheck their original author's staff permission before delivery.

Discord requests are not one transaction. If setup stops midway, fix the reported permission/hierarchy problem and rerun a fresh preview/confirmation. Saved IDs and created-resource records are reused. API send intents, recovery markers and nonces reduce duplicate sends after uncertain responses; they are not a promise of cross-process exactly-once delivery. Multiple concurrent bot instances are unsupported.

Do not clear either data file to bypass a safety error. If the saved Verified role is deleted, use the [verification recovery procedure](docs/rules-recovery.md) and inspect intended public/private gates before changing role mappings. Existing privileged role differences and ambiguous resource names require manual administrator review.

## Tests and rollout

```sh
npm run check
npm test
npm run commands:preview
```

The suite uses real SQLite files and an in-memory Discord API fixture to exercise setup safety/idempotency, confirmation, roles, privacy, XP, tickets, moderation, scheduler recovery, provider adapters, polls, and events. Provider HTTP and Discord mutations are mocked; a passing suite is not a live integration result.

Follow the [complete manual acceptance checklist](docs/complete-testing.md) in a development server before community rollout. The [original rules checklist](docs/rules-testing.md) remains useful for rules-specific recovery. Record your own live results separately.

See the [phase-by-phase implementation status](docs/implementation-status.md) for the code delivered, automated evidence, credential audit scope, and remaining live checks.

Project modules: `src/commands`, `src/events`, `src/config`, `src/database`, and individual services under `src/services`. The approved rules text remains unchanged in `src/config/rules-text.js`.
