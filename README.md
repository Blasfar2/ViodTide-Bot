# VOIDTIDE Bot

A JavaScript Discord bot for the VOIDTIDE gaming and streaming community, built with **discord.js v14** and **Node.js 24 LTS**.

**Phase 2** adds the VOIDTIDE rules and member verification system to the working `/ping` foundation. Server access changes happen only when an administrator confirms `/setup-rules` after reviewing its preview.

The project package is named `voidtide-discord-bot`. The existing checkout is named `ViodTide-Bot`; creating this project does not rename or publish the GitHub repository.

## Token security — do this first

The bot token shared in chat must be treated as exposed. Open the [Discord Developer Portal](https://discord.com/developers/applications), select your application, go to **Bot**, and choose **Reset Token**. Use the replacement token only in your local `.env` file or your host's secret settings.

Never paste a token into chat, source code, screenshots, or Git. The bot token is a password; the application ID and server ID are identifiers. `.env` is ignored by Git, and `.env.example` contains no secrets.

## What is included

- A modular project with commands, events, services, and configuration.
- A `/ping` command for checking whether the bot is responding.
- Explicit registration of slash commands in one development server.
- Environment validation, safe error messages, and graceful shutdown.
- Offline checks and tests that do not need a Discord token.
- An administrator-only `/setup-rules` command with a preview before applying channel permissions.
- The exact approved community rules, a public rules channel, and an **✅ I Agree** verification button.
- `/rules` for a private copy of the rules anytime.
- Persistent rules configuration and safe reuse of the channel, role, and message on repeated setup.

Only the standard **Guilds** intent is enabled. Message Content, Server Members, Presence, and other privileged intents are unnecessary. The bot does not need Administrator permission.

## Requirements

- Node.js **24 LTS** and its bundled npm.
- A Discord application with a bot account.
- A Discord server where you can install apps, usually through **Manage Server** permission.
- Internet access to install packages and connect to Discord.

If you already use [nvm](https://github.com/nvm-sh/nvm), select the pinned Node version from the project directory:

```sh
nvm install
nvm use
```

Check your tools:

```sh
node --version
npm --version
```

## 1. Install dependencies

Open a terminal in the directory containing `package.json`:

```sh
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`. Commit the lockfile when you commit the project so future installs use the same dependency versions.

## 2. Configure the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and select your bot's application, or create an application named **VOIDTIDE Bot**.
2. On **Bot**, create the bot account if needed. Reset the exposed token and securely copy the replacement.
3. On **General Information**, copy the **Application ID**.
4. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your server and choose **Copy Server ID**.
5. Copy the environment template:

```sh
cp .env.example .env
```

On Windows, you can copy and rename the file in your editor instead. Edit `.env` locally and fill in:

| Variable | Where to get it |
| --- | --- |
| `DISCORD_TOKEN` | The replacement token from the application's **Bot** page. Keep it secret. |
| `DISCORD_CLIENT_ID` | **Application ID** from **General Information**. |
| `DISCORD_GUILD_ID` | **Copy Server ID** in Discord. |

Leave all three privileged intent switches off. The code loads `.env` through `dotenv`; deployment hosts can supply the same variables directly without a file.

## 3. Invite the bot

1. In the Developer Portal, open your application's **Installation** page.
2. Enable **Guild Install**. For its install settings, select the `bot` and `applications.commands` scopes.
3. Grant **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**, **Manage Channels**, and **Manage Roles**. Their combined permission value is `268520464`. Rules setup needs the two management permissions to create/reuse the rules channel and `Verified` role, configure access, and assign that role after agreement.
4. Open the generated install link, choose your server, and authorize the installation.

Alternatively, replace `YOUR_APPLICATION_ID` in this URL with your application ID and open it:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=268520464&integration_type=0&scope=bot%20applications.commands
```

If the bot is already installed from Phase 1, update its permissions using this link or its server role settings. In **Server Settings → Roles**, put the bot's highest role above `Verified`; Discord prevents it from assigning a role at or above its own highest role. Channel permission overrides still apply. Do not grant Administrator to solve a channel permission problem.

## 4. Check and register the commands

These checks are offline and work without credentials:

```sh
npm run check
npm test
npm run commands:preview
```

`check` runs syntax and lint checks. `test` runs automated tests. `commands:preview` prints the slash-command definitions without sending them to Discord.

Once `.env` contains the replacement token and correct IDs, register `/ping`, `/rules`, and `/setup-rules`:

```sh
npm run deploy:commands
```

Registration sends the current command list to the server specified by `DISCORD_GUILD_ID`. **It replaces this application's slash commands in that server** with the commands in this project. It does not change other applications' commands or global commands. Use a development server, and rerun this command when command names, descriptions, or options change.

Command registration and starting the bot are separate actions: registering a command makes it appear in Discord; the running bot handles its interactions.

## 5. Run and test in Discord

Start the bot:

```sh
npm start
```

Keep the process running. After the ready message appears in the terminal:

1. Open the configured Discord server and your test channel.
2. Type `/ping` and select the command belonging to your bot.
3. Send it and confirm that the bot responds with **Pong!** and latency information.
4. Check the terminal for unexpected errors.

This is the live end-to-end check. Offline checks validate the code, but cannot prove that a token is valid, the installation is correct, or the bot can respond in your server.

## 6. Set up rules and verification

Use a development server first. Take a record of your existing channel permissions before applying the setup; stopping the bot does not undo Discord permission changes.

### Review the permission changes

An administrator runs `/setup-rules` without options to receive a private preview. This creates no Discord channel, role, or message and changes no permissions. Review the listed targets and address any permission or role hierarchy errors before confirming. The same administrator must confirm within **10 minutes**. If the relevant channels, roles, or permissions change after review, or the bot restarts, run a new preview.

When you run `/setup-rules confirm:true`, setup applies these changes:

| Target | Change |
| --- | --- |
| `Verified` role | Create a plain member role if needed, or reuse a safe existing role. It grants access through channel overrides; it receives no administrator or moderation powers. |
| Existing public channels | Deny **View Channel** to `@everyone` and allow it to `Verified`. Members must agree before they can see these channels. |
| Existing private channels | Keep their access controls intact, including staff channels. |
| `📜・rules` | Create or reuse one public channel, publish the approved rules, and make it read-only for members. If its permissions are synchronized with a category that will be gated, move only this rules channel to the server root before gating. Unverified members retain View Channel, Read Message History, Use Application Commands, and the verification button. Member messages, threads, and added reactions are disabled. |
| Bot access | Keep the bot able to maintain its rules message; add an explicit View Channel allowance for the bot on each gated public channel. |

**All non-administrator members who lack `Verified`, including existing members, lose access to the gated channels until they agree.** Setup does not automatically verify existing members. Administrators bypass channel restrictions in Discord; managed bot roles are also treated as deliberate exceptions. Review bot access separately if your server has other integrations.

Existing role or member overrides that allow **View Channel** can bypass a deny for `@everyone`. Setup refuses unsupported conflicting overrides instead of claiming verification is enforced. Review the reported override in Discord and rerun the preview. Setup also refuses ambiguous duplicate channel/role candidates, an age-restricted rules channel, and a `Verified` role with elevated permissions, staff permission grants in a channel, or access to private channels outside the saved verification gates. Resolve these manually; it does not delete existing roles or channels. Role safety and channel access are checked again before each verification role assignment.

The command is limited to administrators by Discord's default command permissions and checks authorization again when used. The bot itself needs only the permissions listed in the invitation step.

### Apply and use the rules

1. Run `/setup-rules` as an administrator and review the private preview.
2. Within 10 minutes, use the same administrator account to run `/setup-rules confirm:true`. It applies the reviewed access changes and publishes the rules with **✅ I Agree**. Confirmation without a current matching preview is refused.
3. Test with a separate ordinary member account that has no staff permissions. Before agreement, it should see the rules channel and no gated community channels.
4. Click **✅ I Agree**. The bot assigns `Verified` and responds privately; the gated channels become visible. A repeated click is safe.
5. Run `/rules` for a private copy of the exact approved text. This command does not assign a role or publish another message.

Repeated confirmed setup reuses the saved channel, role, and rules message. It updates that message rather than posting another rules panel. If the message was deleted, setup can publish its replacement and save the new ID. If a saved rules channel or `Verified` role was renamed, setup refuses to continue until you restore its expected name; it does not create a replacement. It never treats existing similarly named duplicates as permission to delete them.

The rules channel remains accessible after verification. This system restricts channel visibility; it does not send welcome messages, assign other member roles, create the full server layout, or moderate conversations. New public channels created later need another `/setup-rules` preview and confirmed run to join the verification gate.

### Keep persistent data safe

Rules settings and Discord IDs are saved locally in `data/rules.json`, which is ignored by Git. Writes use an atomic file replacement. Keep the data directory writable and back it up; use persistent storage when hosting the bot. A deleted Codespace or disposable host disk loses this state. Do not commit runtime data or store a token in it.

Run **one bot process** against this file. Concurrent bot instances are unsupported. After moving to a new host, restore the data before starting the bot and rerun the preview to check saved IDs and permissions. If a Discord operation fails partway through, fix the reported problem, inspect the server, and rerun setup; Discord changes are separate API calls and are not a single transaction.

### Recover a deleted verification role

This is a rare administrator recovery procedure, not a normal setup step. If the saved `Verified` role was deleted while gates still exist, setup stops without creating or adopting a replacement, even when another role has the same name. A channel may have become private since the original setup, so blindly restoring all old access would be unsafe. Do not clear the state file to bypass the error.

1. Stop the bot and copy `data/rules.json` to a safe backup. Keep this original backup unchanged while repairing the working file.
2. In Discord, create a normal member role named exactly `Verified`, or identify one unique safe existing `Verified` role. Give it no staff/moderation permissions or unrelated private-channel access, and place the bot's highest role above it.
3. Review every channel/category ID in the affected server's `gatedChannelIds`. Check current access and whether it is still intended to be a community channel. Add a **View Channel** allow for the chosen `Verified` role only on those intended gates. Review category inheritance and private staff channels too.
4. In the working `data/rules.json`, find the affected server under `guilds` and set `verifiedRoleId` to the chosen role's ID as a quoted string. Remove any channels/categories that were converted to private use from `gatedChannelIds`, and remove any `Verified` access grants from those private channels. Leave other servers and settings unchanged. Preserve valid JSON.
5. Restart the bot, run `/setup-rules`, review the complete preview, then confirm as the same administrator. Test with an ordinary account that community access works and private channels remain private. Existing members must agree again if deletion removed their role.

If the backup or intended access is unclear, keep the bot stopped while an administrator reconstructs the intended permissions. Do not recover by granting `Verified` access to every channel.

Follow the [Phase 2 test checklist](docs/rules-testing.md) before using this in the community server. Live Discord checks must be performed with your own installation; offline tests cannot verify real channel overrides or role assignment.

For development, restart automatically when JavaScript files change:

```sh
npm run dev
```

Stop either mode with **Ctrl+C**. The bot disconnects cleanly. It remains online only while a computer or server is running the Node.js process; this project does not require Replit or any paid service.

## Project structure

```text
scripts/
  deploy-commands.js          # Preview or register guild commands
src/
  commands/
    index.js                 # Command collection
    ping.js                  # /ping definition and handler
    rules.js                 # /rules definition and handler
    setup-rules.js           # Administrator rules setup
  config/
    env.js                   # Environment loading and validation
    rules-text.js            # Exact approved community rules
  events/
    client-ready.js          # Ready event
    interaction-create.js    # Command/button routing and error handling
  services/
    client.js                # Discord client creation
    logger.js                # Application logging
    register-commands.js     # Command registration service
  index.js                   # Bot entry point and shutdown handling
data/rules.json              # Runtime rules settings (ignored by Git)
docs/rules-testing.md         # Manual Phase 2 verification checklist
.env.example                 # Safe configuration template
.nvmrc                       # Node.js major version
package.json                 # Dependencies and npm scripts
package-lock.json            # Reproducible dependency versions
```

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| A required variable is missing | Edit `.env` in the project directory and restart the process. Use the exact names shown in `.env.example`. |
| Invalid token or unauthorized request | Reset the token in the correct application and update `DISCORD_TOKEN` locally. Do not share it for debugging. |
| Registration reports missing access | Confirm the bot is installed in the server, both IDs belong to the intended application/server, and the installation includes `applications.commands`. |
| `/ping` is missing | Run `npm run deploy:commands`, check that you are in the configured server, and reopen Discord if its command list has not refreshed. |
| Discord says the application did not respond | Keep `npm start` running, wait for the ready message, and check the terminal. Re-register if the installed command list is stale. |
| The bot cannot reply in a channel | Check the channel's View Channels and Send Messages overrides and your own application-command permissions. |
| `/rules` or `/setup-rules` is missing | Redeploy commands after updating the code. Only administrators should see `/setup-rules` by default. |
| Setup reports missing permissions | Give the bot the permissions in the invitation step and check its channel overrides. Review the preview again before confirming. |
| Setup reports a duplicate or unsafe role/channel | Resolve the reported candidates or permissions manually, then rerun the preview. Setup does not delete them for you. |
| Setup reports a renamed saved resource | Restore the exact names `📜・rules` and `Verified`, then rerun the preview. No replacement is created for a rename. |
| Setup reports a deleted `Verified` role with existing gates | Follow the recovery procedure above. Do not clear the state file or grant the replacement access to all channels. |
| The rules channel is age-restricted | An administrator must remove its age restriction so all newcomers can access it, then rerun preview. |
| Verification cannot assign `Verified` | Move the bot's highest role above `Verified`, check Manage Roles, and ensure `Verified` is not managed by an integration. |
| An existing member cannot see community channels | They need to read the rules and click **✅ I Agree** too. Confirm the rules channel is still visible. |
| A new channel is visible before verification | Run `/setup-rules`, review the new target, then confirm setup again. |
| Settings cannot be saved | Ensure `data/` is writable, storage is available, and only one bot process uses the file. |
| Node or dependency errors | Use Node 24 LTS and rerun `npm ci` from the project directory. |

discord.js handles Discord REST rate-limit queues. Avoid repeatedly redeploying commands or running multiple copies of this bot during testing. Errors are logged without intentionally printing configuration secrets; still review terminal output before sharing it.

## Later phases

Rules and verification are implemented in Phase 2. Future work includes announcements and scheduling, XP and reward roles, tickets and logs, full channel and role setup, welcome/goodbye messages, moderation and anti-spam, Twitch/YouTube notifications, and interactive polls. These systems are not implemented in this phase.

The planned server structure includes **Information**, **Community**, **Gaming**, **Streaming**, **Support**, and **Staff** categories, plus an accessible text channel for deaf and hard-of-hearing members. Setup commands will not run until those features are implemented and explicitly used.

Community team: **VOIDTIDE** and **Badr** — Founders; **Yacin**, **Nisrine**, and **Mehdi** — Co-Founders; **VoidToid Bot** — Bots. Later role assignment will use Discord member IDs rather than relying on display names.
