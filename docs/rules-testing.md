# Rules and verification checklist

Use a disposable development server first. The checkboxes below are manual checks to perform; an unchecked item has not been verified in Discord. Automated checks do not connect to Discord or prove that real server permissions are correct.

## Prepare

- [ ] Use Node.js 24 LTS, run `npm ci`, and configure your own `.env` with the bot token and application/server IDs. Never paste the token into logs or chat.
- [ ] Run `npm run check`, `npm test`, and `npm run commands:preview`; all finish successfully.
- [ ] Inspect the preview definitions: `/ping`, `/rules`, and administrator-only `/setup-rules` appear, with an optional Boolean `confirm` option on setup.
- [ ] Invite the bot with View Channels, Send Messages, Embed Links, Read Message History, Manage Channels, and Manage Roles. Do not give it Administrator.
- [ ] Place the bot's highest role above `Verified` if that role already exists.
- [ ] Record the server's current channel overwrites. Include a public text channel, public voice channel, a private staff channel, and an ordinary test member without privileged roles.
- [ ] Keep a separate administrator account available for recovery. `@everyone` denies do not restrict administrators.
- [ ] Run `npm run deploy:commands`, then `npm start`; verify `/ping` still works.

## Preview and authorization

- [ ] As an administrator, run `/setup-rules` without `confirm`. Only you can see the preview.
- [ ] Verify that the preview lists the intended access changes and that no role, channel, message, or overwrite changed.
- [ ] A confirmation without a current preview by the same administrator is refused. A preview more than 10 minutes old, a bot restart, or relevant server changes after preview requires a fresh preview.
- [ ] Run `/setup-rules confirm:false` and confirm it also changes nothing.
- [ ] As an ordinary member, confirm `/setup-rules` is unavailable by default. If an administrator has changed command visibility, verify that the runtime administrator check still refuses the operation without modifying anything.
- [ ] Confirm `/rules` returns a private embed with the exact approved text, including its punctuation, emoji, line breaks, accessibility rule, and final community slogan.

## Confirmed setup

Read the permission explanation in the [README](../README.md#6-set-up-rules-and-verification) before this step. Confirmed setup changes visibility for existing members as well as newcomers.

- [ ] As the same administrator, run `/setup-rules confirm:true` within 10 minutes of the preview. Confirm that it completes or returns a specific safe error.
- [ ] Confirm that exactly one `📜・rules` channel and one safe `Verified` role exist.
- [ ] Confirm that the rules channel contains one branded embed with the exact approved text and a working **✅ I Agree** button.
- [ ] Confirm that `data/rules.json` was created and contains saved configuration/Discord IDs, with no credentials. Check `git status --short` to ensure it is ignored.
- [ ] Check each previously public channel: `@everyone` is denied View Channel and `Verified` is allowed View Channel. Include public voice channels in the check.
- [ ] Verify that private staff channels retain their original visibility and remain hidden from ordinary `Verified` members.
- [ ] If the existing rules channel has permissions synchronized with a public category, confirm that only the rules channel moves to the server root before its category is gated. Unverified members must still see the rules.
- [ ] Confirm the bot can still read and edit its rules panel. Confirm staff administrator access remains available.

## Newcomer experience and role assignment

- [ ] Join with an ordinary test account or use one without `Verified`. Confirm the rules channel remains visible while gated channels are hidden.
- [ ] Confirm the account can read message history and click the button, but cannot post messages, create/post in threads, or add reactions in the rules channel.
- [ ] Confirm the account can invoke `/rules` in the rules channel and receive the approved text privately without gaining a role.
- [ ] Click **✅ I Agree**. Confirm a private response, one `Verified` role assignment, and access to the gated channels.
- [ ] Click again, including a rapid double-click. Confirm a safe already-verified/success response without duplicate messages, roles, or unhandled errors.
- [ ] Confirm a previously existing non-administrator member without `Verified` must also agree. No mass verification should occur during setup.
- [ ] Confirm a verified member can still read rules and invoke `/rules` later.
- [ ] With a non-administrator staff account, check its real access carefully: unrelated explicit View Channel allows can bypass `@everyone` denies, so setup must report unsupported conflicts before applying a misleading gate.

## Repetition and persistence

- [ ] Repeat preview then confirmed setup twice more. The role, channel, and rules message IDs remain the same, and only one rules panel exists.
- [ ] Restart the bot and rerun preview, then confirmed setup. The saved role/channel/message are reused.
- [ ] Rename the configured rules channel or role, then rerun preview. Setup refuses the renamed resource without creating a replacement. Restore the expected name (`📜・rules` or `Verified`) and confirm a fresh preview/setup reuses its original ID.
- [ ] Delete only the saved rules message, then run preview and confirmed setup. One replacement panel appears and its new ID is persisted.
- [ ] Create another public channel after setup. Confirm preview lists it before confirmed setup adds it to the gate.
- [ ] Back up `data/`, restore it into the intended host's persistent storage, and verify a restart reuses the resources. Run a single process only.

## Safe failures in a test server

Restore each deliberately changed permission after testing. Do not use a production server to create conflicts or simulate failures.

- [ ] Remove Manage Channels temporarily. Setup explains the missing permission and does not claim success.
- [ ] Remove Manage Roles or move `Verified` above the bot. Setup/verification reports the hierarchy or permission issue privately and does not claim a role was assigned.
- [ ] Add an explicit View Channel allow for an unrelated member role on a public channel. Preview/setup reports the unsupported verification bypass; it does not silently call the channel restricted.
- [ ] Give a candidate `Verified` role elevated privileges. Setup refuses to reuse it as the verification reward.
- [ ] Give `Verified` a staff permission grant in a channel, or access to a private channel outside the saved gates. Setup refuses the role. Remove that grant before continuing.
- [ ] After a successful setup, add an unsafe permission or unrelated private-channel access to `Verified`. A new verification click refuses to assign it; remove the unsafe grant before retesting.
- [ ] Mark the existing rules channel age-restricted. Setup refuses it so newcomers cannot be directed to an inaccessible rules channel. Remove the restriction before retesting.
- [ ] Create ambiguous duplicate `Verified` roles or rules channel candidates in a clean test state without saved IDs. Setup refuses the ambiguity and does not delete candidates.
- [ ] In a disposable server, delete the saved `Verified` role while saved gates exist. Setup refuses to create or adopt a replacement, including when a new same-name role exists. Use the README's manual recovery procedure, including a review of any channels converted to private use, and verify no private access is granted.
- [ ] Deny Embed Links, Send Messages, or Read Message History in the rules channel. Setup reports the relevant access problem without exposing tokens or raw credentials.
- [ ] Stop the bot, back up the data file, and make the test copy malformed. Restart and invoke `/setup-rules`; confirm it reports a storage error rather than silently discarding configuration. Stop the bot and restore the original before continuing.
- [ ] Inspect logs after every failure: errors are understandable, the process does not crash on an interaction, and no secrets appear.

Discord changes involve multiple requests. If a real operation fails after some changes were applied, inspect the server, correct the reported cause, and rerun setup. Do not assume every partial change was rolled back. Keep the original overwrite record if you need to manually restore access.

## Before community rollout

- [ ] Announce when verification will be enabled so existing members know why their channels may disappear.
- [ ] Repeat the ordinary-member and private-staff checks on the actual server after setup.
- [ ] Keep `data/` on persistent storage with a backup, keep `.env` private, and run one bot process.
- [ ] Rerun setup after adding public channels, and review access after changing Discord role/channel overrides.
- [ ] Record your own live test date and any remaining failures. Do not mark Phase 2 live-tested based only on automated test results.
