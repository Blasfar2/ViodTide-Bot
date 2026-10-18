# Auto-fix and auto-rule acceptance checklist

Use a test server and a backup of `data/`. Enable the required intents and place the bot above its managed member roles. Stop other bot copies.

- [ ] After deploying commands, `/auto-fix` and `/auto-rule` appear only for administrators. Ordinary members cannot invoke either through customized command visibility.
- [ ] `/auto-fix` preview creates no Discord resources and changes no permissions; read every action and ID in its private JSON attachment.
- [ ] A text channel named `gaming` remains while the missing GAMING category is created on confirmation.
- [ ] A voice channel named `general` is renamed to an archive name, retains its data, and a correct general text channel is created.
- [ ] Duplicates are archived; the saved compatible ID is preferred, otherwise the oldest compatible channel is chosen.
- [ ] A renamed saved general channel is restored and moved into COMMUNITY. Its own overwrites remain unchanged.
- [ ] STAFF resources become private to ordinary/Verified members and accessible to the intended staff roles; inspect the listed synced category children too.
- [ ] Confirming without a preview, after changing deletion options, after changing a role/channel, as a different administrator, after ten minutes, or after restart fails before repair.
- [ ] Without `delete_conflicts:true`, no channel/category is deleted.
- [ ] In a disposable test only, preview `delete_conflicts:true`: verify the exact duplicate IDs, then confirm with the same option. Only listed DELETE targets disappear, including their history. Referenced/system resources and categories with children are archived instead.
- [ ] A Discord permission error stops repair; completed IDs and audit entries survive restart. A fresh preview repairs remaining work without duplicate creates.
- [ ] `/auto-rule logo:` accepts your PNG/JPEG/WebP attachment during preview. Confirmation without reattaching it posts three separate bot messages: logo, welcome/rules 01–10, then violations/agreement and a green ✅ I Agree button. Concatenating the two text descriptions preserves the approved wording exactly.
- [ ] An unverified test member can read rules/welcome and cannot see the gated general channel; clicking Agree assigns Verified and unlocks general, while staff and private tickets stay hidden.
- [ ] Repeated `/auto-rule` preview/confirm edits the existing three messages without duplicates; repeating Agree reports already verified. Migration from the old single panel keeps one ordered sequence.
- [ ] Delete a middle rules post in the test server, then rerun preview/confirm. The bot restores three correctly ordered posts and only the last has an active button.
- [ ] Restart and rerun `/auto-rule` without a logo option. It reuses `data/rules-assets/`, with no external image host and no repeated logo download.
- [ ] Stop the bot: messages and logo remain readable, while the custom button cannot assign Verified. Restart to restore button handling. Native Rules Screening is a separate optional system described in `docs/offline-rules.md`.
- [ ] Ordinary members can still read `/rules` at any time; approved text is unchanged.
- [ ] Missing Manage Roles or an unsafe/elevated Verified role prevents verification safely.

Automated coverage is in `tests/auto-management.test.js`, plus the existing setup/rules suites. Discord-specific permission propagation, actual gateway login, and real API failures require the manual checks above.
