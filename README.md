# VOIDTIDE Bot

A simple gaming and live-streaming community bot using **Node.js 24 LTS**, **JavaScript**, and **discord.js v14**. Rules, leveling, tickets, announcements, moderation, streaming, polls and events use persistent storage.

## Run in Codespaces

Stop any older bot process with Ctrl+C, then run:

```sh
git pull --ff-only
nvm install
nvm use
npm ci
cp -n .env.example .env
```

Fill in your ignored `.env` locally. Never share tokens or commit credentials:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
ENABLE_COMMUNITY=true
```

Reset the token previously shared in chat if it has not already been rotated. In [Discord Developer Portal](https://discord.com/developers/applications), select the application → **Bot** and enable **Server Members Intent** and **Message Content Intent**. Presence Intent is unnecessary. Discord may require approval for privileged intents on larger applications. With `ENABLE_COMMUNITY=false`, foundation commands and `/auto-rule` remain available, but full setup/services are disabled.

```sh
npm run check
npm test
npm run commands:preview
npm run check:config
npm run deploy:commands
npm start
```

Register commands after updating this release to add `/manage-server`. Registration replaces only this application's command list in `DISCORD_GUILD_ID`. It does not configure the server. Leave `npm start` running; use Ctrl+C to stop. `check`, `test` and `commands:preview` work without credentials; `check:config` validates formats without authenticating or printing values.

## Interactive profile panels

Run **`/manage-server` → ⚙️ Setup Panels**, read the private plan, then click **Confirm** or **Cancel**. Existing permissions remain unchanged. The bot creates/reuses:

| Category | Channels |
| --- | --- |
| 🎭 CUSTOMIZE YOUR PROFILE | 🎭・choose-your-roles, 🔔・notification-roles, 🌍・choose-country |
| 🔴 VOIDTIDE LIVE & SOCIALS | 🔴・live-now, ▶️・youtube, 🎵・tiktok, 📸・instagram, 🌐・social-updates |

Members toggle the five community roles, choose multiple platform notification roles, or select one optional country flag. They can remove choices anytime; confirmations are private. Flag roles are visible in Discord; no precise locations or member-to-country records are stored. Purple/cyan panels reuse your saved VOIDTIDE logo and continue working after bot restarts.

The dashboard provides channel/role name modals, notification settings, country controls and panel refresh, all with reviewed confirmation before changes. Existing rules, gaming, welcome, support, levels and staff resources remain. Read the [setup guide, permissions and Discord test checklist](docs/profile-customization.md) before confirming. Base `/setup-server` below remains available; profile setup upgrades its role/live-now destinations without moving them back on later base setup runs.

## Invite and permissions

Basic setup needs **View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, and Manage Roles**. Moderation additionally needs **Manage Messages, Moderate Members, Kick Members, and Ban Members**; Discord events need **Manage Events**. Administrator is unnecessary.

The existing full-feature invite is:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=1108370123798&integration_type=0&scope=bot%20applications.commands
```

Replace `YOUR_APPLICATION_ID`. Place the bot above member/reward roles and moderation targets. Only existing staff should hold channel-management or privileged role-management permissions. Setup never grants those permissions to members, creates staff roles, or assigns staff roles. The server owner manages privileged roles manually.

Command registration can succeed while gateway login fails. A `4014` startup diagnostic means Discord rejected privileged intents: save both required switches for the correct application and restart. Never paste `.env` when asking for help.

## Preview and confirm the simple setup

1. Back up `data/` and test in a development server first.
2. As an administrator, run **`/setup-server`**. Read the private summary and complete JSON attachment. Preview makes no Discord changes.
3. Within ten minutes, run **`/setup-server confirm:true`** using the same administrator. Changes to roles, channels, settings or a process restart invalidate the preview.
4. Run **`/setup-status`** and test with an ordinary member account.

Setup creates missing resources and reuses saved IDs or unambiguous matching names. It can rename existing layout resources and move them into their listed categories **without synchronizing or editing their permission overwrites**. Unrelated resources and existing messages remain. Duplicates, wrong channel types, unsafe self-selectable roles and public staff resources stop setup for manual review.

**No existing channels are deleted. No existing permissions are changed. No privileged roles are created or assigned. No welcome or goodbye channels are created.** Existing welcome channels remain untouched, while automatic welcome/goodbye messages are disabled. `/auto-fix` is now an alias for this same policy; destructive repair options are rejected. `/setup-roles` and `/setup-channels` have their own preview/confirmation and do not publish the full service panels.

### Requested layout

| Category | Channels |
| --- | --- |
| 📌 VOIDTIDE INFO | 📜・rules, 📢・announcements, 🎭・choose-roles |
| 🎮 LET'S PLAY | 💬・gaming-chat, 🎮・find-players, 📸・game-clips, 🏆・levels |
| 🔴 LIVE & STREAM | 🔴・live-now, 📺・streams, 🎬・youtube-clips |
| 🔊 GAME ROOMS | 🎧・Game Room 1, 🎧・Game Room 2, 🎧・Game Room 3 |
| 🎫 HELP | 🎫・support |
| 🔒 VOIDTIDE STAFF — private | 🛡️・staff-chat, 📋・bot-logs |

A fresh server gets **6 categories, 13 text channels and 3 voice channels**. Important information stays available in text. Gaming chat explicitly welcomes Deaf, hard-of-hearing and hearing members; voice participation is optional.

**Permissions for newly created resources are shown before confirmation.** Public resources allow @everyone to view/read; information and panel channels are read-only. New staff resources deny @everyone View Channel and allow the bot and existing roles that already have staff permissions. The owner/administrators retain Discord's inherent access. No staff powers are granted. If an existing staff area is public, staff must review it manually; setup will not silently change it.

### Public role-selection panel

Setup publishes one panel in **🎭・choose-roles**:

- 🎮 **Gamer**
- 🔴 **Live Notification**
- 🎬 **Video Notification**
- 🤟 **Sign Language**
- 🏆 **Events**

Anyone can click to add a choice and click again to remove it, without needing Verified. Discord's own membership screening must be completed first. These roles have **zero server privileges and no channel permission grants**. They cannot manage channels, manage roles or open private staff areas. Runtime checks reject elevated, managed, inaccessible or reordered roles and stale/copied panels. The bot creates/reuses Verified and existing level-reward roles at levels 5/10/20/30/50 to preserve those services, also without staff powers.

If a legacy role-selection channel is private, setup preserves it and creates the new public named channel instead of editing its overwrites. The old bot-owned panel is retired with a link to the new panel. A public compatible panel is updated in place. Existing custom channel names/permissions that make the intended target ambiguous require manual review.

## Rules and logo

**❌ I Disagree has been removed.** Setup refreshes the saved rules panel with **✅ I Agree** only. Agree assigns Verified using the existing verification safeguards. Existing verification gates and all existing channel overwrites are retained. This simple setup does not add new gates or remove existing ones; newly created public channels are public. Staff/tickets remain private.

For your three-message presentation, run **`/auto-rule`**, select **logo**, and upload your VOIDTIDE PNG/JPEG/WebP (up to 5 MiB). Review the preview, then run **`/auto-rule confirm:true`** without attaching the image again. The bot sends:

1. Your original logo.
2. The welcome and rules 01–10, with bold headings and readable paragraph spacing.
3. Violations and the highlighted agreement, with the green **✅ I Agree** button.

Approved wording remains in `src/config/rules-text.js`. `/rules` gives a private full-text view. Saved message IDs and history recovery prevent duplicate rules sequences. Later updates reuse the local logo under ignored `data/rules-assets/`; no webhook or external image-hosting service is needed. Both normal Discord uploads and temporary slash-command attachments are supported. If no logo has been uploaded, the preview explains that the bot avatar is used.

After simple setup, `/auto-rule` and `/setup-rules` also preserve existing permissions. A legacy rules-only installation keeps its original explicit permission-preview behavior until simple setup is confirmed. Existing private-channel grants on Verified are checked before assignment; dangerous or deleted role mappings require the [recovery procedure](docs/rules-recovery.md).

## Existing features and commands

| System | Commands |
| --- | --- |
| Health | `/ping` |
| Setup | `/setup-server`, `/setup-roles`, `/setup-channels`, `/auto-fix`; preview then `confirm:true` |
| Profile management | `/manage-server` — three persistent panels, name modals, country/social settings; Confirm/Cancel |
| Status | `/setup-status`, `/channel-status` |
| Rules | `/rules`, `/auto-rule [logo]`, `/setup-rules` |
| Role panel | `/role-panel` — administrator-only publishing; five public toggle buttons |
| Announcements | `/announce title description [image] [link]` |
| Scheduling | `/schedule-announcement create time title description`; `list`; `cancel id` |
| Levels | `/rank [member]`, `/leaderboard`, `/level-rewards`, `/xp-admin member xp` |
| Support | `/ticket-panel`, `/ticket category`, `/close-ticket` |
| Moderation | `/warn`, `/warnings`, `/timeout`, `/kick`, `/ban`, `/clear` |
| Streaming | `/stream-config add provider account channel`; `list`; `remove` |
| Community | `/poll question options closes`, `/event title description start end location` |
| Jobs | `/jobs` — staff health/retry status |

Existing XP, warnings/cases, tickets, schedules, stream checkpoints and service destinations are retained. Fresh installations send level notices to 🏆・levels, tickets to 🎫・support and private logs to 📋・bot-logs. Legacy private log destinations remain configured. Open ticket channel IDs remain valid even if the support category was reorganized.

Verified humans earn 15 XP per meaningful eligible message, at most once per minute. Bots, webhooks, repetitive/spam content, staff channels and tickets do not earn XP. Level is `floor(sqrt(XP / 100))`; safe rewards are reconciled at 5/10/20/30/50. Moderation retains permission/hierarchy checks, protected targets, anti-spam and persistent cases. Tickets remain private to their requester, authorized staff and the bot; closing retains a read-only archive. Logs are checked for privacy before confidential details are sent.

Schedules require an ISO timestamp with timezone, such as `2027-01-20T20:00:00Z`. Durable jobs retry with backoff, resume after restart and stop after five failures; inspect `/jobs`. Announcement delivery rechecks the author's staff permission. Polls retain one vote per member and persistent results.

The legacy `/welcome-config` command remains available only for an explicit administrator opt-in using an already existing channel; setup never enables it or creates a destination.

## Twitch and YouTube

Optional credentials stay in `.env`/secure host settings:

```dotenv
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
YOUTUBE_API_KEY=
```

Twitch uses an app client-credentials token and lowercase login names. YouTube requires Data API v3 and a 24-character channel ID starting `UC`, not a handle. Checks run every five minutes while the bot runs, up to 20 accounts. YouTube establishes a baseline first and catches up at most the latest 50 items. Provider authentication needs live testing.

After profile setup, alerts mention only their platform opt-in role, with persistent deduplication and a default five-minute platform cooldown. Configure destinations/enabled status/cooldown through `/manage-server` → **Notification Settings**, then add accounts with `/stream-config` using that same destination. Default destinations are live-now and ▶️・youtube. Existing explicit social settings remain. Without profile setup, existing non-pinging deliveries continue. Discord role pings require the optional channel permission explained in the [profile guide](docs/profile-customization.md); it is never granted automatically. No @everyone/@here/user pings are allowed. TikTok, Instagram and X provide saved role/settings support only; automatic integrations are unavailable. No external subscriptions or paid services are required.

## Storage, hosting and checks

Run **one bot process per data directory**. Back up the whole ignored `data/` directory while stopped: `community.sqlite` and any WAL/SHM files, `rules.json`, and `rules-assets/`. Do not clear files to bypass a safety error. Discord API operations are not one transaction; a failure requires a fresh preview and reuses the saved IDs.

Your PC can be off while an active Codespace runs the bot. A sleeping/stopped/deleted Codespace stops gateway events and workers; this is not guaranteed free 24/7 hosting. Posted messages remain visible offline, but buttons need the bot running. See [offline rules and native Discord screening](docs/offline-rules.md). No Replit or paid service is introduced.

`npm run check`, `npm test` and `npm run commands:preview` validate the code offline. Tests use real SQLite files and mocked Discord/provider calls; they do not prove live Discord permissions or provider authentication. Use the [simple setup checklist](docs/auto-management-testing.md) and [feature checklist](docs/complete-testing.md) in a test server. Project modules are under `src/commands`, `src/events`, `src/config`, `src/database` and `src/services`.
