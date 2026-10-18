# Recovering deleted or renamed verification resources

Use this procedure only as a server administrator/operator. Stop the bot and back up the entire `data/` directory first. Do not clear either data store to bypass a safety error.

## Renamed rules channel or role

The standalone legacy rules service requires its saved rules channel and role to retain the expected names `📜・rules` and `Verified`. Restore those names, then preview `/setup-server` or `/setup-rules` again. No replacement is created just because a saved resource was renamed.

## Deleted Verified role

A deleted role cannot be restored with the same Discord ID. Automatic replacement is refused while saved gates exist because some old community channels may have since become private.

1. Stop the bot; keep an unchanged backup of `data/rules.json` and `data/community.sqlite` and any WAL/SHM files.
2. In Discord, create or choose one normal role named `Verified` with zero server-wide permissions. Put the bot above it. Do not give it staff privileges or unrelated private-channel access.
3. Review each ID in `guilds.<SERVER_ID>.gatedChannelIds` in the working `rules.json`. Add a View Channel allow for the new role only on channels/categories that are still intended community gates. Remove grants from anything converted to staff/private use. Review inherited category behavior as well.
4. In the working JSON, change only that server's `verifiedRoleId` to the new role ID as a quoted string. Remove converted-private channel IDs from `gatedChannelIds`. Keep valid JSON and preserve other servers/settings.
5. Restart and run a fresh `/setup-server` preview, inspecting its attached full plan. On confirmation, combined setup adopts the reviewed rules mapping and updates its SQLite configuration. If combined setup is not enabled, use the standalone `/setup-rules` preview/confirmation.
6. Test with an ordinary account. Intended community access works; private channels remain private. Members need to agree again if their old role membership was deleted.

If a channel was converted to private use, remove its Verified allow rather than merely hiding it from @everyone. Do not grant the replacement role access to every channel. If intended access is unclear, leave the bot stopped while an administrator reconstructs it.

## Deleted rules message or external ticket deletion

A deleted rules message is recreated during a fresh reviewed setup. Saved IDs and full bot-message history are checked before posting another panel. If multiple existing panels are found, resolve those manually.

A ticket channel deliberately deleted outside the bot is recorded as externally deleted. The requester can run `/ticket` again for a new private ticket. The old ticket's database record is retained; its deleted messages cannot be recovered by the bot.
