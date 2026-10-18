# VOIDTIDE Bot

A JavaScript Discord bot for the VOIDTIDE gaming and streaming community, built with **discord.js v14** and **Node.js 24 LTS**.

This is **Phase 1**: a working bot foundation with the `/ping` slash command. Later features will be added after Phase 1 works in your Discord server.

The project package is named `voidtide-discord-bot`. The existing checkout is named `ViodTide-Bot`; creating this project does not rename or publish the GitHub repository.

## Token security — do this first

The bot token shared in chat must be treated as exposed. Open the [Discord Developer Portal](https://discord.com/developers/applications), select your application, go to **Bot**, and choose **Reset Token**. Use the replacement token only in your local `.env` file or your host's secret settings.

Never paste a token into chat, source code, screenshots, or Git. The bot token is a password; the application ID and server ID are identifiers. `.env` is ignored by Git, and `.env.example` contains no secrets.

## What Phase 1 includes

- A modular project with commands, events, services, and configuration.
- A `/ping` command for checking whether the bot is responding.
- Explicit registration of slash commands in one development server.
- Environment validation, safe error messages, and graceful shutdown.
- Offline checks and tests that do not need a Discord token.

Only the standard **Guilds** intent is enabled. Phase 1 does not need Message Content, Server Members, Presence, or any other privileged intent. It does not need Administrator permission.

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
3. Give the bot only **View Channels** and **Send Messages** for Phase 1. Their combined permission value is `3072`.
4. Open the generated install link, choose your server, and authorize the installation.

Alternatively, replace `YOUR_APPLICATION_ID` in this URL with your application ID and open it:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&permissions=3072&integration_type=0&scope=bot%20applications.commands
```

Channel permission overrides still apply. Pick a test channel where the bot can view and send messages and where your account can use application commands. Do not grant Administrator to solve a channel permission problem.

## 4. Check and register the command

These checks are offline and work without credentials:

```sh
npm run check
npm test
npm run commands:preview
```

`check` runs syntax and lint checks. `test` runs automated tests. `commands:preview` prints the slash-command definitions without sending them to Discord.

Once `.env` contains the replacement token and correct IDs, register `/ping`:

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
  config/
    env.js                   # Environment loading and validation
  events/
    client-ready.js          # Ready event
    interaction-create.js    # Slash-command routing and error handling
  services/
    client.js                # Discord client creation
    logger.js                # Application logging
    register-commands.js     # Command registration service
  index.js                   # Bot entry point and shutdown handling
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
| Node or dependency errors | Use Node 24 LTS and rerun `npm ci` from the project directory. |

discord.js handles Discord REST rate-limit queues. Avoid repeatedly redeploying commands or running multiple copies of this bot during testing. Errors are logged without intentionally printing configuration secrets; still review terminal output before sharing it.

## Later phases

Phase 2 is intentionally not implemented yet. After `/ping` works and you confirm Phase 1, the roadmap includes rules and verification, announcements and scheduling, XP and reward roles, tickets and logs, channel and role setup, welcome/goodbye messages, moderation and anti-spam, Twitch/YouTube notifications, and interactive polls. Persistent storage and administrator authorization will be added with the features that need them.

The planned server structure includes **Information**, **Community**, **Gaming**, **Streaming**, **Support**, and **Staff** categories, plus an accessible text channel for deaf and hard-of-hearing members. Setup commands will not run until those features are implemented and explicitly used.

Community team: **VOIDTIDE** and **Badr** — Founders; **Yacin**, **Nisrine**, and **Mehdi** — Co-Founders; **VoidToid Bot** — Bots. Later role assignment will use Discord member IDs rather than relying on display names.
