import io
import logging

import discord

from store import config, record, remove, save, state

log = logging.getLogger("guardian.panels")


async def owner_room(interaction):
    member = interaction.user
    if not isinstance(member, discord.Member) or not member.voice or not member.voice.channel:
        return None
    channel = member.voice.channel
    saved = state["rooms"].get(str(channel.id))
    return channel if saved and saved["ownerId"] == str(member.id) else None


class TicketPanel(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Открыть тикет", style=discord.ButtonStyle.primary, custom_id="ticket:open")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        if not guild:
            return await interaction.response.send_message("Только на сервере.", ephemeral=True)
        settings = config(guild.id)["tickets"]
        category = guild.get_channel(int(settings.get("categoryId", 0)))
        staff = guild.get_role(int(settings.get("staffRoleId", 0)))
        if not isinstance(category, discord.CategoryChannel) or not staff or staff == guild.default_role:
            return await interaction.response.send_message("Сначала настройте тикеты командой `/tickets setup`.", ephemeral=True)
        for ticket in state["tickets"].values():
            if ticket["guildId"] == str(guild.id) and ticket["openerId"] == str(interaction.user.id):
                return await interaction.response.send_message(f"У вас уже есть тикет: <#{ticket['channelId']}>", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        bot_member = guild.me or await guild.fetch_member(interaction.client.user.id)
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
            staff: discord.PermissionOverwrite(view_channel=True, send_messages=True, read_message_history=True),
            bot_member: discord.PermissionOverwrite(view_channel=True, send_messages=True, manage_channels=True, read_message_history=True),
        }
        channel = await guild.create_text_channel(f"ticket-{interaction.user.name}"[:90], category=category, overwrites=overwrites, reason=f"Guardian ticket for {interaction.user.id}")
        record("tickets", channel.id, {"guildId": str(guild.id), "channelId": str(channel.id), "openerId": str(interaction.user.id)})
        await channel.send(content=f"<@{interaction.user.id}> <@&{staff.id}>", embed=discord.Embed(title="Тикет открыт", description="Опишите вопрос. Для закрытия нажмите кнопку ниже.", color=0x5865F2), view=TicketClose(), allowed_mentions=discord.AllowedMentions(users=True, roles=True, everyone=False))
        await interaction.followup.send(f"Тикет создан: {channel.mention}", ephemeral=True)


class TicketClose(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Закрыть тикет", style=discord.ButtonStyle.danger, custom_id="ticket:close")
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild, channel = interaction.guild, interaction.channel
        saved = state["tickets"].get(str(channel.id)) if channel else None
        if not guild or not isinstance(channel, discord.TextChannel) or not saved:
            return await interaction.response.send_message("Это не тикет.", ephemeral=True)
        staff_id = config(guild.id)["tickets"].get("staffRoleId")
        member = interaction.user
        allowed = str(member.id) == saved["openerId"] or member.guild_permissions.manage_channels or (staff_id and any(str(role.id) == staff_id for role in member.roles))
        if not allowed:
            return await interaction.response.send_message("Закрыть тикет может автор или поддержка.", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        lines = []
        async for message in channel.history(limit=1000, oldest_first=True):
            attachments = " ".join(item.url for item in message.attachments)
            lines.append(f"{message.created_at.isoformat()} {message.author}: {message.content.replace(chr(10), ' ')} {attachments}")
        log_id = config(guild.id)["tickets"].get("logChannelId")
        log_channel = guild.get_channel(int(log_id)) if log_id else None
        if isinstance(log_channel, discord.TextChannel):
            data = io.BytesIO(("\n".join(lines) or "Нет сообщений.").encode("utf-8"))
            try:
                await log_channel.send(f"Тикет {channel.id} от <@{saved['openerId']}> закрыт <@{member.id}>. Последние {len(lines)} сообщений.", file=discord.File(data, filename=f"ticket-{channel.id}.txt"), allowed_mentions=discord.AllowedMentions.none())
            except discord.DiscordException:
                log.exception("Could not send ticket transcript")
        remove("tickets", channel.id)
        await interaction.followup.send("Тикет закрыт.", ephemeral=True)
        await channel.delete(reason=f"Guardian: closed by {member.id}")


class RenameModal(discord.ui.Modal, title="Название комнаты"):
    name = discord.ui.TextInput(label="Новое название", max_length=80)

    async def on_submit(self, interaction: discord.Interaction):
        channel = await owner_room(interaction)
        if not channel:
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        await channel.edit(name=str(self.name).strip() or "Комната")
        await interaction.response.send_message("Название обновлено.", ephemeral=True)


class LimitModal(discord.ui.Modal, title="Лимит участников"):
    limit = discord.ui.TextInput(label="Число от 0 до 99", max_length=2)

    async def on_submit(self, interaction: discord.Interaction):
        channel = await owner_room(interaction)
        if not channel:
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        value = str(self.limit).strip()
        if not value.isdigit() or not 0 <= int(value) <= 99:
            return await interaction.response.send_message("Лимит должен быть числом от 0 до 99.", ephemeral=True)
        await channel.edit(user_limit=int(value))
        await interaction.response.send_message("Лимит обновлён.", ephemeral=True)


class RoomPanel(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Название", style=discord.ButtonStyle.primary, custom_id="room:rename")
    async def rename(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await owner_room(interaction):
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        await interaction.response.send_modal(RenameModal())

    @discord.ui.button(label="Лимит", style=discord.ButtonStyle.primary, custom_id="room:limit")
    async def limit(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not await owner_room(interaction):
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        await interaction.response.send_modal(LimitModal())

    @discord.ui.button(label="Закрыть / открыть", style=discord.ButtonStyle.secondary, custom_id="room:lock")
    async def lock(self, interaction: discord.Interaction, button: discord.ui.Button):
        channel = await owner_room(interaction)
        if not channel:
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        overwrite = channel.overwrites_for(channel.guild.default_role)
        locked = overwrite.connect is False
        overwrite.connect = None if locked else False
        await channel.set_permissions(channel.guild.default_role, overwrite=overwrite)
        await interaction.response.send_message("Комната открыта." if locked else "Комната закрыта для новых входов.", ephemeral=True)

    @discord.ui.button(label="Удалить пустую", style=discord.ButtonStyle.danger, custom_id="room:delete")
    async def delete(self, interaction: discord.Interaction, button: discord.ui.Button):
        channel = await owner_room(interaction)
        if not channel:
            return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
        if len(channel.members) > 1:
            return await interaction.response.send_message("Сначала дождитесь выхода остальных участников.", ephemeral=True)
        remove("rooms", channel.id)
        await interaction.response.send_message("Комната удалена.", ephemeral=True)
        await channel.delete(reason="Guardian: удалена владельцем")


async def voice_update(member, before, after):
    if before.channel == after.channel:
        return
    guild = member.guild
    settings = config(guild.id)["rooms"]
    if before.channel and str(before.channel.id) in state["rooms"]:
        saved = state["rooms"][str(before.channel.id)]
        if not before.channel.members:
            remove("rooms", before.channel.id)
            try:
                await before.channel.delete(reason="Guardian: временная комната пуста")
            except discord.DiscordException:
                log.exception("Could not delete empty room")
        elif saved["ownerId"] == str(member.id):
            saved["ownerId"] = str(before.channel.members[0].id)
            save()
    if not after.channel or str(after.channel.id) != settings.get("lobbyId") or not settings.get("categoryId"):
        return
    category = guild.get_channel(int(settings["categoryId"]))
    if not isinstance(category, discord.CategoryChannel):
        return
    for saved in list(state["rooms"].values()):
        if saved["guildId"] == str(guild.id) and saved["ownerId"] == str(member.id):
            existing = guild.get_channel(int(saved["channelId"]))
            if isinstance(existing, discord.VoiceChannel):
                await member.move_to(existing)
                return
            remove("rooms", saved["channelId"])
    channel = await guild.create_voice_channel(f"Комната {member.display_name}"[:100], category=category, user_limit=settings.get("defaultLimit", 0), reason=f"Guardian room for {member.id}")
    record("rooms", channel.id, {"guildId": str(guild.id), "channelId": str(channel.id), "ownerId": str(member.id)})
    try:
        await member.move_to(channel)
    except discord.DiscordException:
        remove("rooms", channel.id)
        await channel.delete(reason="Guardian: не удалось переместить владельца")
        raise
