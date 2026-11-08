# Twitch alerts while the bot is offline

The optional **Twitch live alerts** GitHub Actions workflow checks [voidtideus](https://www.twitch.tv/voidtideus) using Twitch's official Helix API. It sends an alert through Discord's REST API as your existing VOIDTIDE Bot account. It does not open a Discord gateway session, so the bot can appear offline while posting. Your PC and Codespace can be off.

The workflow is **disabled by default**. Nothing posts until you configure the settings below and explicitly enable it. No channels, roles or permission overwrites are created or edited, and no webhook is required. The regular bot and its rules, XP, tickets and moderation services remain available when you run it.

## 1. Merge the feature first

Merge this feature branch into your repository's default branch (`main`). GitHub runs scheduled workflows from the default branch. No slash command registration is needed for this feature.

The supplied workflow only runs in **public repositories**, on standard GitHub-hosted Ubuntu runners, where standard Actions compute is free. It skips private repositories to avoid automatically consuming billable minutes. Do not make a private repository public just for this feature. A private repository needs a separately reviewed hosting/scheduling choice.

## 2. Get Twitch API credentials

Open the [Twitch Developer Console](https://dev.twitch.tv/console/apps), sign in and register an application if you do not already have one. Use the application's **Client ID** and **Client Secret**. The worker uses the app client-credentials flow, not a user password or interactive viewer subscription. Follow Twitch's current application registration requirements; no paid service is needed by this code.

## 3. Add GitHub Actions secrets

In **Blasfar2/ViodTide-Bot → Settings → Secrets and variables → Actions → Secrets**, create these **repository secrets**:

| Secret name | Value to enter securely |
| --- | --- |
| `DISCORD_TOKEN` | Your current bot token from the Discord Developer Portal. Reset the token previously exposed in chat if you have not already done so. |
| `TWITCH_CLIENT_ID` | Twitch application's Client ID. |
| `TWITCH_CLIENT_SECRET` | Twitch application's Client Secret. |

Your Codespace `.env` does not automatically become Actions secrets. Never paste secret values into chat, workflow YAML, source code or GitHub variables. The workflow supplies secrets only to the notifier step, after installing locked dependencies without lifecycle scripts. It has read-only repository permissions and no pull-request trigger.

## 4. Add GitHub Actions variables

On the **Variables** tab, create these **repository variables**:

| Variable name | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Your Discord bot application's ID, matching the token above. |
| `DISCORD_GUILD_ID` | Your VOIDTIDE server ID. |
| `TWITCH_LIVE_CHANNEL_ID` | The ID of your existing `🔴・live-now` channel. |
| `TWITCH_NOTIFICATION_ROLE_ID` | The ID of the existing **Twitch** / **🟣 Twitch** nonprivileged opt-in role selected in Discord's Channels & Roles questions. |
| `TWITCH_LOGIN` | `voidtideus` (a login name, not the full URL). |
| `TWITCH_ALERT_COOLDOWN_MINUTES` | `5` by default; accepts 1–1440. |

Enable **Discord User Settings → Advanced → Developer Mode** to copy IDs. Right-click your server/channel to copy its ID; copy the Twitch role ID from Server Settings → Roles. IDs are identifiers, not token values. Use the same destination and Twitch role if your regular bot also monitors this account.

## 5. Review existing bot access

The bot needs **View Channel, Send Messages, Embed Links and Read Message History** in the selected live channel. The channel can remain restricted to Verified members; the worker does **not** require @everyone visibility.

To ping a nonmentionable opt-in role, Discord requires **Mention @everyone, @here, and All Roles** (`MentionEveryone`) for the bot in that channel. Alternatively, the role must already be mentionable. Prefer granting the permission only to the bot in the intended notification channel after reviewing it. The code never changes either setting automatically. Its `allowed_mentions` permits **only the Twitch role**; @everyone, @here and user mentions remain disabled, including strings inside Twitch titles.

The configured role must be named Twitch (optionally prefixed with 🟣), be unmanaged, below the bot, have no server-wide permissions and no channel permission grants. The worker never assigns roles. Members opt in through your existing native Discord question/panel.

## 6. Enable and test

Create the final repository variable **`VOIDTIDE_OFFLINE_TWITCH_ENABLED` = `true`** only after the other settings are complete. This is your explicit opt-in to live message delivery.

1. Open **Actions → Twitch live alerts → Run workflow**, select `main`, then run it.
2. Inspect the notifier step. It validates Discord access and Twitch credentials. If the stream is offline, it posts nothing. If already live, the first successful run can announce the ongoing stream immediately.
3. While live, verify the message is authored by your bot in `live-now`, links to `https://www.twitch.tv/voidtideus`, and mentions only the Twitch opt-in role.
4. Run it again: it should report that the stream was already announced and send nothing.
5. Stop your Codespace bot and PC; scheduled checks continue on GitHub. Bot buttons and other gateway features still need their own running bot process; native Discord role questions work independently.
6. Restart the regular bot using the same bot account and destination. It recognizes the same stream footer/nonce and adopts the existing alert instead of reposting it.

To stop these alerts, set **`VOIDTIDE_OFFLINE_TWITCH_ENABLED` = `false`** or disable this workflow in Actions. An already-running check may finish; cancel its run if needed. The Actions worker has separate settings from the regular bot's `/manage-server` because it cannot access your Codespace SQLite database. Disabling notifications there alone does not disable the Actions worker; disable the GitHub variable as well. Keep destination, opt-in role and cooldown settings consistent.

## Timing and duplicate prevention

The cron requests a check every five minutes, offset from the busy top of the hour. GitHub can delay or skip scheduled runs, and disables scheduled workflows in public repositories after 60 days without repository activity. This is periodic best-effort automation, not guaranteed instant or continuous hosting. It cannot detect a short stream that starts and ends between checks. Provider access and quotas still apply.

Persistent Discord message history is the shared delivery record. Each alert carries the same bot-owned stream marker and deterministic nonce as the regular bot, with `enforce_nonce` enabled. Repeated invocations and uncertain send responses recover an existing message. Only one scheduled check runs at a time; recent Twitch alerts impose the configured cooldown. Do not run other accounts/processes with different destinations and expect shared deduplication across channels. Existing normal-bot records are preserved.

Keep the alert messages: deleting an alert or changing the destination removes that history-based record and can allow an ongoing stream to be announced again. The worker paginates up to 10,000 messages and stops without posting if it cannot complete recovery. Use a dedicated live-alert channel. It never deletes old alerts to bypass this limit.

## Checks and local use

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
npm run notify:twitch
```

The last command is disabled without the explicit enable flag. To run a real check locally, securely configure the same variables/secrets in your ignored environment first; enabling it authorizes a live post if Twitch is live. Run only one bot process per existing data directory.

Automated tests mock Twitch and Discord REST, exercising enable gating, configuration, private-channel permissions, opt-in mentions, Twitch offline/live behavior, multi-page history, cooldowns, invalid/privileged role refusal, lost responses and normal-bot recovery. They do not prove your provider credentials, live Discord permissions, GitHub scheduling or billing configuration. No real token is committed or used by the tests.
