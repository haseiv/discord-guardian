import logging
import os
from datetime import datetime, timezone
from typing import Literal

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

from panels import RoomPanel, TicketClose, TicketPanel, owner_room, voice_update
from security import handle_audit, handle_join, handle_message, security_log
from store import config, remove, save, state

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("guardian")

intents = discord.Intents.default()
intents.members = True
intents.moderation = True
intents.message_content = False


class GuardianBot(commands.Bot):
    async def setup_hook(self):
        self.add_view(TicketPanel())
        self.add_view(TicketClose())
        self.add_view(RoomPanel())
        guild_id = os.getenv("DISCORD_DEV_GUILD_ID")
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
        else:
            synced = await self.tree.sync()
        log.info("Registered %s command groups", len(synced))


bot = GuardianBot(command_prefix="!", intents=intents, help_command=None)


async def require(interaction, permission):
    member = interaction.user
    if interaction.guild and isinstance(member, discord.Member) and getattr(member.guild_permissions, permission):
        return True
    await interaction.response.send_message("Недостаточно прав для этой команды.", ephemeral=True)
    return False


def safe_role(role):
    permissions = role.permissions
    dangerous = (
        permissions.administrator or permissions.manage_guild or permissions.manage_roles
        or permissions.manage_channels or permissions.manage_webhooks
        or permissions.manage_messages or permissions.kick_members
        or permissions.ban_members or permissions.moderate_members
    )
    me = role.guild.me
    return bool(me and me.guild_permissions.manage_roles and role != role.guild.default_role and not role.managed and role < me.top_role and not dangerous)


@bot.event
async def on_ready():
    log.info("Guardian online as %s", bot.user)


@bot.event
async def on_member_join(member):
    settings = config(member.guild.id)
    role_id = settings.get("autoroleRoleId")
    if role_id and not member.bot:
        age_days = (datetime.now(timezone.utc) - member.created_at).total_seconds() / 86400
        minimum = settings["security"]["minAccountAgeDays"] if settings["security"]["enabled"] else 0
        if age_days >= minimum:
            role = member.guild.get_role(int(role_id))
            if role and safe_role(role):
                try:
                    await member.add_roles(role, reason="Guardian: автороль при входе")
                except discord.DiscordException:
                    log.exception("Could not assign autorole")
            else:
                await security_log(member.guild, "Ошибка автороли", f"Роль {role_id} недоступна для выдачи.")
    await handle_join(member)


@bot.event
async def on_audit_log_entry_create(entry):
    await handle_audit(entry)


@bot.event
async def on_message(message):
    await handle_message(message)


@bot.event
async def on_voice_state_update(member, before, after):
    try:
        await voice_update(member, before, after)
    except discord.DiscordException:
        log.exception("Voice room update failed")


@bot.event
async def on_guild_channel_delete(channel):
    if str(channel.id) in state["tickets"]:
        remove("tickets", channel.id)
    if str(channel.id) in state["rooms"]:
        remove("rooms", channel.id)


@bot.tree.error
async def command_error(interaction, error):
    log.error("Command failed", exc_info=error)
    text = "Не удалось выполнить действие. Проверьте права бота и настройки."
    if interaction.response.is_done():
        await interaction.followup.send(text, ephemeral=True)
    else:
        await interaction.response.send_message(text, ephemeral=True)


guardian = app_commands.Group(name="guardian", description="Настройки защиты")


@guardian.command(name="status", description="Показать настройки защиты")
async def guardian_status(interaction: discord.Interaction):
    if not await require(interaction, "manage_guild"):
        return
    c = config(interaction.guild.id)
    s = c["security"]
    log_channel = f"<#{c['logChannelId']}>" if c.get("logChannelId") else "не задан"
    text = f"Защита: {'вкл' if s['enabled'] else 'выкл'}\nЖурнал: {log_channel}\n"
    text += (f"Рейд: {s['joinLimit']} входов / {s['joinWindowSeconds']} сек., таймаут {s['raidDurationMinutes']} мин.\n"
             f"Возраст аккаунта: {s['minAccountAgeDays']} дн.\n"
             f"Антинюк: {s['auditLimit']} действий / {s['auditWindowSeconds']} сек.; {s['sanction']}\n"
             f"Флуд: {s['spamLimit']} сообщений / {s['spamWindowSeconds']} сек.\n"
             f"Доверенные: {', '.join('<@'+v+'>' for v in c['trustedIds']) or 'нет'}")
    await interaction.response.send_message(text, ephemeral=True, allowed_mentions=discord.AllowedMentions.none())


@guardian.command(name="logs", description="Канал журнала безопасности")
async def guardian_logs(interaction: discord.Interaction, channel: discord.TextChannel):
    if not await require(interaction, "manage_guild"):
        return
    config(interaction.guild.id)["logChannelId"] = str(channel.id)
    save()
    await interaction.response.send_message("Канал журнала сохранён.", ephemeral=True)


@guardian.command(name="toggle", description="Включить или выключить защиту")
async def guardian_toggle(interaction: discord.Interaction, enabled: bool):
    if not await require(interaction, "manage_guild"):
        return
    config(interaction.guild.id)["security"]["enabled"] = enabled
    save()
    await interaction.response.send_message("Настройка сохранена.", ephemeral=True)


@guardian.command(name="raid", description="Порог массового входа")
async def guardian_raid(interaction: discord.Interaction, joins: app_commands.Range[int, 2, 100], seconds: app_commands.Range[int, 5, 300], timeout: app_commands.Range[int, 1, 60]):
    if not await require(interaction, "manage_guild"):
        return
    s = config(interaction.guild.id)["security"]
    s.update(joinLimit=joins, joinWindowSeconds=seconds, raidDurationMinutes=timeout)
    save()
    await interaction.response.send_message("Порог антирейда сохранён.", ephemeral=True)


@guardian.command(name="account-age", description="Минимальный возраст аккаунта; 0 выключает")
async def guardian_age(interaction: discord.Interaction, days: app_commands.Range[int, 0, 365]):
    if not await require(interaction, "manage_guild"):
        return
    config(interaction.guild.id)["security"]["minAccountAgeDays"] = days
    save()
    await interaction.response.send_message("Возраст аккаунта сохранён.", ephemeral=True)


@guardian.command(name="antinuke", description="Порог опасных действий")
async def guardian_antinuke(interaction: discord.Interaction, actions: app_commands.Range[int, 2, 30], seconds: app_commands.Range[int, 5, 300], sanction: Literal["ban", "kick", "strip"]):
    if not await require(interaction, "manage_guild"):
        return
    s = config(interaction.guild.id)["security"]
    s.update(auditLimit=actions, auditWindowSeconds=seconds, sanction=sanction)
    save()
    await interaction.response.send_message("Порог антинюка сохранён.", ephemeral=True)


@guardian.command(name="spam", description="Порог флуда")
async def guardian_spam(interaction: discord.Interaction, messages: app_commands.Range[int, 2, 30], seconds: app_commands.Range[int, 2, 60], timeout: app_commands.Range[int, 1, 60]):
    if not await require(interaction, "manage_guild"):
        return
    s = config(interaction.guild.id)["security"]
    s.update(spamLimit=messages, spamWindowSeconds=seconds, spamTimeoutMinutes=timeout)
    save()
    await interaction.response.send_message("Порог антифлуда сохранён.", ephemeral=True)


@guardian.command(name="trust-add", description="Добавить доверенного пользователя")
async def guardian_trust_add(interaction: discord.Interaction, user: discord.User):
    if not await require(interaction, "manage_guild"):
        return
    values = config(interaction.guild.id)["trustedIds"]
    if str(user.id) not in values:
        values.append(str(user.id))
        save()
    await interaction.response.send_message("Пользователь добавлен.", ephemeral=True)


@guardian.command(name="trust-remove", description="Удалить доверенного пользователя")
async def guardian_trust_remove(interaction: discord.Interaction, user: discord.User):
    if not await require(interaction, "manage_guild"):
        return
    values = config(interaction.guild.id)["trustedIds"]
    if str(user.id) in values:
        values.remove(str(user.id))
        save()
    await interaction.response.send_message("Пользователь удалён.", ephemeral=True)


bot.tree.add_command(guardian)


autorole = app_commands.Group(name="autorole", description="Автоматическая роль новым участникам")


@autorole.command(name="set", description="Выдавать роль при входе")
async def autorole_set(interaction: discord.Interaction, role: discord.Role):
    if not await require(interaction, "manage_roles"):
        return
    member = interaction.user
    if not safe_role(role) or (member.id != interaction.guild.owner_id and role >= member.top_role):
        return await interaction.response.send_message("Бот и вы должны стоять выше роли. Административные и модераторские роли нельзя использовать как автороль.", ephemeral=True)
    config(interaction.guild.id)["autoroleRoleId"] = str(role.id)
    save()
    await interaction.response.send_message(f"Новые участники будут получать {role.mention}.", ephemeral=True, allowed_mentions=discord.AllowedMentions.none())


@autorole.command(name="off", description="Отключить автороль")
async def autorole_off(interaction: discord.Interaction):
    if not await require(interaction, "manage_roles"):
        return
    config(interaction.guild.id).pop("autoroleRoleId", None)
    save()
    await interaction.response.send_message("Автороль выключена. Уже выданные роли остаются.", ephemeral=True)


@autorole.command(name="status", description="Показать автороль")
async def autorole_status(interaction: discord.Interaction):
    if not await require(interaction, "manage_roles"):
        return
    role_id = config(interaction.guild.id).get("autoroleRoleId")
    await interaction.response.send_message(f"Автороль: <@&{role_id}>" if role_id else "Автороль выключена.", ephemeral=True, allowed_mentions=discord.AllowedMentions.none())


bot.tree.add_command(autorole)


tickets = app_commands.Group(name="tickets", description="Панель тикетов")


@tickets.command(name="setup", description="Настроить категорию, роль поддержки и журнал")
async def tickets_setup(interaction: discord.Interaction, category: discord.CategoryChannel, staff: discord.Role, log_channel: discord.TextChannel):
    if not await require(interaction, "manage_guild"):
        return
    if staff == interaction.guild.default_role:
        return await interaction.response.send_message("Для поддержки выберите отдельную роль, не @everyone.", ephemeral=True)
    config(interaction.guild.id)["tickets"].update(categoryId=str(category.id), staffRoleId=str(staff.id), logChannelId=str(log_channel.id))
    save()
    await interaction.response.send_message("Тикеты настроены. Используйте `/tickets panel`.", ephemeral=True)


@tickets.command(name="panel", description="Разместить панель тикетов")
async def tickets_panel(interaction: discord.Interaction, channel: discord.TextChannel, title: str = "Поддержка", description: str = "Нажмите кнопку, чтобы открыть приватный тикет."):
    if not await require(interaction, "manage_guild"):
        return
    if not config(interaction.guild.id)["tickets"].get("categoryId"):
        return await interaction.response.send_message("Сначала `/tickets setup`.", ephemeral=True)
    await channel.send(embed=discord.Embed(title=title[:256], description=description[:4000], color=0x5865F2), view=TicketPanel(), allowed_mentions=discord.AllowedMentions.none())
    await interaction.response.send_message(f"Панель размещена в {channel.mention}.", ephemeral=True)


bot.tree.add_command(tickets)


rooms = app_commands.Group(name="rooms", description="Временные голосовые комнаты")


@rooms.command(name="setup", description="Указать вход и категорию комнат")
async def rooms_setup(interaction: discord.Interaction, lobby: discord.VoiceChannel, category: discord.CategoryChannel, limit: app_commands.Range[int, 0, 99] = 0):
    if not await require(interaction, "manage_guild"):
        return
    config(interaction.guild.id)["rooms"].update(lobbyId=str(lobby.id), categoryId=str(category.id), defaultLimit=limit)
    save()
    await interaction.response.send_message("Комнаты настроены. Используйте `/rooms panel`.", ephemeral=True)


@rooms.command(name="panel", description="Разместить панель управления комнатой")
async def rooms_panel(interaction: discord.Interaction, channel: discord.TextChannel):
    if not await require(interaction, "manage_guild"):
        return
    settings = config(interaction.guild.id)["rooms"]
    if not settings.get("lobbyId") or not settings.get("categoryId"):
        return await interaction.response.send_message("Сначала `/rooms setup`.", ephemeral=True)
    await channel.send(embed=discord.Embed(title="Личные голосовые комнаты", description=f"Зайдите в <#{settings['lobbyId']}>: бот создаст комнату. Кнопки работают для её владельца. Команды: `/room invite`, `/room transfer`, `/room kick`.", color=0x57F287), view=RoomPanel(), allowed_mentions=discord.AllowedMentions.none())
    await interaction.response.send_message(f"Панель размещена в {channel.mention}.", ephemeral=True)


bot.tree.add_command(rooms)


room = app_commands.Group(name="room", description="Управление своей комнатой")


@room.command(name="invite", description="Открыть доступ пользователю")
async def room_invite(interaction: discord.Interaction, user: discord.Member):
    channel = await owner_room(interaction)
    if not channel:
        return await interaction.response.send_message("Вы должны находиться в своей комнате.", ephemeral=True)
    await channel.set_permissions(user, view_channel=True, connect=True)
    await interaction.response.send_message("Доступ открыт.", ephemeral=True)


@room.command(name="transfer", description="Передать владение участнику комнаты")
async def room_transfer(interaction: discord.Interaction, user: discord.Member):
    channel = await owner_room(interaction)
    if not channel or user not in channel.members or user.id == interaction.user.id:
        return await interaction.response.send_message("Выберите другого участника своей комнаты.", ephemeral=True)
    state["rooms"][str(channel.id)]["ownerId"] = str(user.id)
    save()
    await interaction.response.send_message("Владение передано.", ephemeral=True)


@room.command(name="kick", description="Отключить участника от комнаты")
async def room_kick(interaction: discord.Interaction, user: discord.Member):
    channel = await owner_room(interaction)
    if not channel or user not in channel.members or user.id == interaction.user.id:
        return await interaction.response.send_message("Выберите другого участника своей комнаты.", ephemeral=True)
    await user.move_to(None, reason="Guardian: удалён владельцем комнаты")
    await interaction.response.send_message("Участник отключён.", ephemeral=True)


bot.tree.add_command(room)


publish = app_commands.Group(name="publish", description="Сообщение от имени бота")


async def can_publish(interaction, channel):
    if not await require(interaction, "manage_messages"):
        return False
    if not channel.permissions_for(interaction.user).manage_messages:
        await interaction.response.send_message("В выбранном канале нужно право управления сообщениями.", ephemeral=True)
        return False
    return True


@publish.command(name="text", description="Опубликовать текст")
async def publish_text(interaction: discord.Interaction, channel: discord.TextChannel, content: str):
    if not await can_publish(interaction, channel):
        return
    if not content or len(content) > 2000:
        return await interaction.response.send_message("Текст должен содержать 1–2000 символов.", ephemeral=True)
    await channel.send(content, allowed_mentions=discord.AllowedMentions.none())
    await interaction.response.send_message(f"Опубликовано в {channel.mention}.", ephemeral=True)


@publish.command(name="embed", description="Опубликовать эмбед")
async def publish_embed(interaction: discord.Interaction, channel: discord.TextChannel, title: str, description: str, color: str = "#5865F2", image: str = ""):
    if not await can_publish(interaction, channel):
        return
    try:
        shade = int(color.removeprefix("#"), 16)
        if not 0 <= shade <= 0xFFFFFF or len(color) != 7:
            raise ValueError()
    except ValueError:
        return await interaction.response.send_message("Цвет укажите как #RRGGBB.", ephemeral=True)
    if image and not image.startswith("https://"):
        return await interaction.response.send_message("Картинка должна иметь HTTPS URL.", ephemeral=True)
    embed = discord.Embed(title=title[:256], description=description[:4000], color=shade)
    if image:
        embed.set_image(url=image)
    await channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
    await interaction.response.send_message(f"Опубликовано в {channel.mention}.", ephemeral=True)


bot.tree.add_command(publish)


if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN") or os.getenv("DISCORD_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    if not token:
        raise RuntimeError("Set DISCORD_TOKEN, DISCORD_BOT_TOKEN or BOT_TOKEN")
    bot.run(token)
