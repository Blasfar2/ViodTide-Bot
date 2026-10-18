# Rules while VOIDTIDE Bot is offline

After `/auto-rule` publishes the logo, rules, and agreement, Discord keeps those messages visible when the bot stops. They are sent by your bot account and do not need your PC or an image-hosting website to remain online. Back up `data/rules-assets/` for future bot updates; the posted attachment itself is hosted by Discord.

The **✅ I Agree** button is a bot interaction. A running, connected VOIDTIDE process must receive it, check the member, and assign Verified. While the process is stopped, the button cannot grant a role; Discord may display an interaction failure. Restarting the process restores handling of the saved current panel. A webhook also cannot assign member roles by itself.

Only **✅ I Agree** is offered; Disagree was removed. The five self-selection role buttons also require the bot to be running.

## Keep your PC off

Codespaces runs on GitHub's cloud infrastructure, so your PC can be off while that Codespace is running. Idle timeouts, available usage, stopping/deleting the Codespace, and network failures still stop your bot. Do not assume Codespaces supplies permanent free 24/7 hosting. Continuous custom-button verification needs a continuously running host. No hosting provider or paid service is configured by this update.

## Accept rules without an online bot

Discord's native **Rules Screening** is a free server feature handled by Discord. It does not depend on your bot being online:

1. As the server owner, open **Server Settings** and enable **Community** if needed. Review Discord's required safety settings.
2. Open **Rules Screening**, usually under **Safety Setup** (Discord's UI labels can vary). Enable the setting requiring members to accept the rules before participating.
3. Add the approved VOIDTIDE rules, review the member preview, and save. The formatted bot messages can remain in 📜・rules for reference.
4. Test with a newly joined ordinary account while the bot is stopped.

See [Discord's Rules Screening FAQ](https://support.discord.com/hc/en-us/articles/1500000466882-Rules-Screening-FAQ) for the current interface and behavior.

**Native acceptance does not assign your custom Verified role.** Existing bot-configured channels remain gated until that role is assigned. If you choose native screening as your sole access system, the server owner must separately review ordinary community-channel permissions to remove the Verified requirement, while retaining private staff/ticket permissions. No mass permission change or automatic switch is performed here. Native screening and role-based channel visibility have different behavior; verify the intended member experience before changing production permissions.
