# YouTube uploads while VOIDTIDE Bot appears offline

The optional **YouTube upload alerts** GitHub Actions workflow watches [@VoidtidePASV](https://www.youtube.com/@VoidtidePASV). It posts through Discord REST as your existing VOIDTIDE Bot account in your selected YouTube channel. Your PC/Codespace can be off. It does not require a webhook, a gateway connection or Twitch credentials.

Each post contains the **video title, thumbnail image, description and watch link**, and mentions only your **YouTube** opt-in role. Descriptions longer than Discord's limit are shortened. Native Discord Channels & Roles questions can assign that role while the gateway bot is offline.

The workflow is **disabled by default**. Nothing posts until you configure and explicitly enable it. No channel, role, member assignment or permission overwrite is created or changed.

## Enable on GitHub

1. Merge `feature/offline-youtube-alerts` into `main`, your repository's default branch. Scheduled workflows use the default branch. No slash command registration is needed.
2. In Google Cloud Console, create/select a project, enable **YouTube Data API v3**, and create an **API key**. Restrict the key to YouTube Data API v3; a browser-referrer restriction is unsuitable for a server-side GitHub runner. This uses the API's free quota; the code does not require a paid service. Provider registration/access and quotas still apply.
3. Open **GitHub repository → Settings → Secrets and variables → Actions**.
4. In **Secrets**, add `YOUTUBE_API_KEY`. Reuse your existing `DISCORD_TOKEN` repository secret from the Twitch workflow, or add your current bot token securely if it is missing. Never put either secret in source code, workflow YAML, public variables or chat. Codespace `.env` values are not automatically Actions secrets.
5. In **Variables**, configure:

| Repository variable | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Existing bot application ID; reuse the Twitch setting. |
| `DISCORD_GUILD_ID` | Existing VOIDTIDE server ID; reuse the Twitch setting. |
| `YOUTUBE_HANDLE` | `@VoidtidePASV` — the API resolves its canonical channel ID automatically. |
| `YOUTUBE_DISCORD_CHANNEL_ID` | ID of your existing `▶️・youtube` Discord channel. |
| `YOUTUBE_NOTIFICATION_ROLE_ID` | ID of the nonprivileged **YouTube** or **▶️ YouTube** role used by your Discord role question. |
| `YOUTUBE_ALERT_COOLDOWN_MINUTES` | `5` by default; accepts 1–1440. |

Enable Discord **User Settings → Advanced → Developer Mode** to copy IDs. Right-click the destination channel to copy its ID; copy the YouTube role ID from Server Settings → Roles. These IDs are identifiers, not API keys.

6. Review the permissions below. Then add the final repository variable **`VOIDTIDE_OFFLINE_YOUTUBE_ENABLED` = `true`**. Setting this explicitly opts into live delivery.
7. Open **Actions → YouTube upload alerts → Run workflow**, select `main`, and run it.

The supplied workflow uses standard GitHub-hosted Ubuntu runners and only runs in **public repositories**, where standard Actions compute is free. It skips private repositories to avoid consuming billed minutes. Do not change repository visibility just for this feature. Private repositories need a separately reviewed scheduling/hosting choice. Install dependencies before the secrets-bearing step; workflows have read-only repository permissions and no pull-request notification trigger.

## Permissions and privacy

The bot needs **View Channel, Send Messages, Embed Links and Read Message History** in the selected channel. The channel can stay restricted to Verified members; @everyone visibility is unnecessary.

Pinging a nonmentionable role requires the bot's **Mention @everyone, @here, and All Roles** (`MentionEveryone`) permission in that destination, or the role must already be mentionable. Prefer granting the permission only to the bot in the intended channel after reviewing it. The worker never changes either setting. Its payload permits exactly the configured YouTube role, disables everyone/here/user mentions, and cannot ping those mentions from a video description.

The role must be below the bot, unmanaged, named YouTube (optionally prefixed with ▶️), have zero server-wide permissions and no channel permission grants. The bot token/application, server, channel, role and effective channel overwrites are validated before delivery. No member list, country or external subscription is collected.

## What gets posted

- **First enabled check:** share the latest published public video once. Older uploads are not flooded into Discord.
- **Later checks:** share newly published videos once, oldest unseen first, at most one per run. Recent YouTube alerts impose the configured cooldown. Twitch messages do not consume YouTube's cooldown.
- **Empty channel:** send nothing; future checks can pick up the first public video.
- **Private/unlisted/deleted videos, upcoming broadcasts and future publication dates:** do not publish. Shorts use the same supported video metadata API when present in the uploads playlist. Published live videos/archives can be included; this is a video feed, not a separate live-status detector.
- The API checks up to the newest 50 uploads. If the previous posted video falls outside that window, share only the latest rather than flood an old backlog. If the handle's canonical channel changes, it starts a latest-only sequence for that channel.

The worker uses official `channels`, `playlistItems` and `videos` Data API endpoints. The API key is sent in a header, not embedded in query URLs or logs. It uses official YouTube thumbnails, with an `i.ytimg.com` fallback. No channel-page scraping, paid integration or invented API access is used.

## One-time delivery and offline behavior

Persistent Discord message history is the shared delivery record. Each bot-owned video post has the same canonical channel/video marker and deterministic nonce as the regular bot. A lost response or later scheduled invocation recognizes it instead of reposting. The regular bot also recognizes the offline post after restart when configured for the same canonical YouTube channel ID and Discord destination. Existing normal-bot announcements are preserved rather than edited by this worker.

Keep the alert messages and destination consistent. Deleting an announcement or changing the destination removes that history-based record and can cause the latest video to be announced again. A history scan exceeding 10,000 messages or failing permissions/pagination stops without posting. Use a dedicated YouTube notification channel.

The schedule requests a check about every five minutes. GitHub may delay/skip runs and disables public-repository schedules after 60 days without repository activity. This is periodic best-effort automation, not guaranteed instant/continuous hosting. Normal bot interactions still require a running gateway process; native Discord role questions and these scheduled REST notifications operate independently.

The Actions configuration is independent of `/manage-server` because GitHub cannot access your Codespace SQLite database. To stop this worker, set **`VOIDTIDE_OFFLINE_YOUTUBE_ENABLED` = `false`** or disable the workflow in Actions; cancel an in-progress run if needed. Disabling the normal bot's YouTube setting alone does not stop Actions. Keep platform role/destination/cooldown settings consistent. Twitch has its own independent enable variable.

## Test checklist

- [ ] Verify the workflow is disabled before configuration; no secrets or network calls are needed for disabled mode.
- [ ] Configure the API key and role/channel IDs securely, enable the variable, then manually run the workflow. A channel with public videos shares only the latest video.
- [ ] Verify the Discord message has the right bot author, title, large thumbnail, description and clickable video link. Only the YouTube opt-in role is mentioned.
- [ ] Run it again: no second post for the same video.
- [ ] Stop the Codespace bot. A new public upload is picked up by later GitHub runs; the bot account can still display offline.
- [ ] Publish two test uploads between checks. They are shared oldest first, one per run, subject to cooldown; each appears once.
- [ ] A private/unlisted/upcoming test video is not shared.
- [ ] Restart the normal bot with the same provider/destination: the offline message is adopted without duplication.
- [ ] Disable the GitHub variable: new scheduled jobs stop posting. Existing messages remain untouched.

Automated tests mock Discord and YouTube, covering configuration, safe role/channel checks, first-run/latest behavior, multi-upload ordering, descriptions/images/links, private/upcoming exclusions, cooldowns, lost-response/restart recovery and cross-worker message adoption. They do not authenticate with your provider credentials or prove live Discord permissions/scheduling.

For local testing use `npm run notify:youtube`; it is disabled unless the explicit enable flag is true. With the same real variables/secrets configured securely, enabling this command can post the latest video immediately. Never enable a live test unintentionally.
