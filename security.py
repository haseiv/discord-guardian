import logging
import time
from collections import defaultdict, deque
from datetime import timedelta, timezone, datetime

import discord

from store import config

log = logging.getLogger("guardian.security")
joins = defaultdict(deque)
audits = defaultdict(deque)
messages = defaultdict(deque)
raid_until = {}

PROTECTED_ACTIONS = {
    discord.AuditLogAction.channel_create, discord.AuditLogAction.channel_delete,
    discord.AuditLogAction.channel_update, discord.AuditLogAction.overwrite_create,
    discord.AuditLogAction.overwrite_delete, discord.AuditLogAction.overwrite_update,
    discord.AuditLogAction.role_create, discord.AuditLogAction.role_delete,
    discord.AuditLogAction.role_update, discord.AuditLogAction.webhook_create,
    discord.AuditLogAction.webhook_delete, discord.AuditLogAction.bot_add,
    discord.AuditLogAction.ban, discord.AuditLogAction.kick,
    discord.AuditLogAction.guild_update,
}


def count_recent(bucket, key, window):
    now = time.monotonic()
    recent = bucket[key]
    while recent and now - recent[0] > window:
        recent.popleft()
    recent.append(now)
    return len(recent)


async def security_log(guild, title, message):
    channel_id = config(guild.id).get("logChannelId")
    channel = guild.get_channel(int(channel_id)) if channel_id else None
    if isinstance(channel, discord.TextChannel):
        try:
            await channel.send(embed=discord.Embed(title=title, description=message[:4000], color=0xED4245), allowed_mentions=discord.AllowedMentions.none())
        except discord.DiscordException:
            log.exception("Could not send security log")
    else:
        log.warning("%s: %s", title, message)


async def punish(member, sanction, reason):
    if sanction == "ban" and member.guild.me.guild_permissions.ban_members and member.top_role < member.guild.me.top_role:
        await member.ban(reason=reason)
        return "бан"
    if sanction == "kick" and member.guild.me.guild_permissions.kick_members and member.top_role < member.guild.me.top_role:
        await member.kick(reason=reason)
        return "кик"
    removable = [role for role in member.roles if role != member.guild.default_role and role < member.guild.me.top_role and not role.managed]
    if removable:
        await member.remove_roles(*removable, reason=reason)
    if member.guild.me.guild_permissions.moderate_members and member.top_role < member.guild.me.top_role:
        await member.timeout(timedelta(hours=1), reason=reason)
    return "сняты роли / таймаут" if removable else "нет прав для наказания"


async def handle_join(member):
    settings = config(member.guild.id)["security"]
    if not settings["enabled"]:
        return
    age_days = (datetime.now(timezone.utc) - member.created_at).total_seconds() / 86400
    if settings["minAccountAgeDays"] and age_days < settings["minAccountAgeDays"]:
        try:
            await member.kick(reason="Guardian: новый аккаунт")
            await security_log(member.guild, "Новый аккаунт", f"<@{member.id}>: кик, возраст {age_days:.1f} дн.")
        except discord.DiscordException:
            log.exception("Could not kick new account")
        return
    now = time.monotonic()
    recent = joins[member.guild.id]
    while recent and now - recent[0][0] > settings["joinWindowSeconds"]:
        recent.popleft()
    recent.append((now, member.id))
    if len(recent) >= settings["joinLimit"] and raid_until.get(member.guild.id, 0) < now:
        raid_until[member.guild.id] = now + settings["raidDurationMinutes"] * 60
        await security_log(member.guild, "Возможный рейд", f"{len(recent)} входов за {settings['joinWindowSeconds']} сек.")
        for _, member_id in list(recent):
            target = member.guild.get_member(member_id)
            if target:
                try:
                    await target.timeout(timedelta(minutes=settings["raidDurationMinutes"]), reason="Guardian: массовый вход")
                except discord.DiscordException:
                    log.exception("Could not timeout raid join")
    elif raid_until.get(member.guild.id, 0) > now:
        try:
            await member.timeout(timedelta(minutes=settings["raidDurationMinutes"]), reason="Guardian: режим защиты от рейда")
        except discord.DiscordException:
            log.exception("Could not timeout raid join")


async def handle_audit(entry):
    guild = entry.guild
    settings = config(guild.id)
    if not settings["security"]["enabled"] or entry.action not in PROTECTED_ACTIONS or not entry.user:
        return
    actor_id = entry.user.id
    if actor_id in (guild.owner_id, guild.me.id) or str(actor_id) in settings["trustedIds"]:
        return
    sec = settings["security"]
    count = count_recent(audits, (guild.id, actor_id), sec["auditWindowSeconds"])
    if count != sec["auditLimit"]:
        return
    member = guild.get_member(actor_id)
    if not member:
        try:
            member = await guild.fetch_member(actor_id)
        except discord.DiscordException:
            member = None
    try:
        result = await punish(member, sec["sanction"], "Guardian: массовые опасные действия") if member else "участник не найден"
    except discord.DiscordException:
        result = "нет прав для наказания"
        log.exception("Could not punish audit actor")
    await security_log(guild, "Защита от ньюка", f"Исполнитель <@{actor_id}>: {count} действий за {sec['auditWindowSeconds']} сек. Действие: {result}.")


async def handle_message(message):
    if not message.guild or message.author.bot or not isinstance(message.author, discord.Member):
        return
    settings = config(message.guild.id)
    sec = settings["security"]
    if not sec["enabled"] or message.author.id == message.guild.owner_id or str(message.author.id) in settings["trustedIds"] or message.author.guild_permissions.manage_messages:
        return
    count = count_recent(messages, (message.guild.id, message.author.id), sec["spamWindowSeconds"])
    if count == sec["spamLimit"]:
        try:
            await message.author.timeout(timedelta(minutes=sec["spamTimeoutMinutes"]), reason="Guardian: флуд")
            await security_log(message.guild, "Защита от флуда", f"<@{message.author.id}>: {count} сообщений за {sec['spamWindowSeconds']} сек.")
        except discord.DiscordException:
            log.exception("Could not timeout spammer")
