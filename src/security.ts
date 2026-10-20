import {
  AuditLogEvent, Client, EmbedBuilder, Events, Guild, GuildAuditLogsEntry,
  GuildMember, Message, PermissionFlagsBits, TextChannel,
} from 'discord.js';
import { guildConfig } from './state.js';

const joins = new Map<string, { at: number; member: GuildMember }[]>();
const raidUntil = new Map<string, number>();
const audits = new Map<string, number[]>();
const messages = new Map<string, number[]>();
const protectedActions = new Set<AuditLogEvent>([
  AuditLogEvent.ChannelCreate, AuditLogEvent.ChannelDelete, AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.RoleCreate, AuditLogEvent.RoleDelete,
  AuditLogEvent.RoleUpdate, AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookDelete,
  AuditLogEvent.BotAdd, AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberKick,
  AuditLogEvent.GuildUpdate,
]);

function record(map: Map<string, number[]>, key: string, windowMs: number): number {
  const now = Date.now();
  const list = (map.get(key) || []).filter(at => now - at < windowMs);
  list.push(now);
  map.set(key, list);
  return list.length;
}

export async function securityLog(guild: Guild, title: string, text: string): Promise<void> {
  const id = guildConfig(guild.id).logChannelId;
  if (!id) { console.log(`[${guild.id}] ${title}: ${text}`); return; }
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased() && 'send' in channel) {
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(title).setDescription(text.slice(0, 4000)).setTimestamp()], allowedMentions: { parse: [] } }).catch(console.error);
  }
}

async function punish(member: GuildMember, reason: string, sanction: 'ban' | 'kick' | 'strip'): Promise<string> {
  if (sanction === 'ban' && member.bannable) { await member.ban({ reason }); return 'бан'; }
  if (sanction === 'kick' && member.kickable) { await member.kick(reason); return 'кик'; }
  const removable = member.roles.cache.filter(role => role.id !== member.guild.id && role.editable).map(role => role.id);
  if (removable.length) await member.roles.remove(removable, reason);
  if (member.moderatable) await member.timeout(60 * 60 * 1000, reason);
  return removable.length || member.moderatable ? 'сняты роли / таймаут' : 'нет прав для наказания';
}

export function installSecurity(client: Client): void {
  client.on(Events.GuildMemberAdd, async member => {
    try {
      const config = guildConfig(member.guild.id).security;
      if (!config.enabled) return;
      const now = Date.now();
      const ageDays = (now - member.user.createdTimestamp) / 86_400_000;
      if (config.minAccountAgeDays && ageDays < config.minAccountAgeDays) {
        const result = member.kickable ? (await member.kick('Guardian: новый аккаунт'), 'кик') : 'нет прав для кика';
        await securityLog(member.guild, 'Новый аккаунт', `<@${member.id}>: ${result} (возраст ${ageDays.toFixed(1)} дн.)`);
        return;
      }
      const list = (joins.get(member.guild.id) || []).filter(item => now - item.at < config.joinWindowSeconds * 1000);
      list.push({ at: now, member });
      joins.set(member.guild.id, list);
      if (list.length >= config.joinLimit && (raidUntil.get(member.guild.id) || 0) < now) {
        raidUntil.set(member.guild.id, now + config.raidDurationMinutes * 60_000);
        await securityLog(member.guild, 'Возможный рейд', `${list.length} входов за ${config.joinWindowSeconds} сек. Новые участники получат таймаут на ${config.raidDurationMinutes} мин.`);
        for (const item of list) {
          if (item.member.moderatable) await item.member.timeout(config.raidDurationMinutes * 60_000, 'Guardian: массовый вход').catch(console.error);
        }
      } else if ((raidUntil.get(member.guild.id) || 0) > now && member.moderatable) {
        await member.timeout(config.raidDurationMinutes * 60_000, 'Guardian: режим защиты от рейда');
      }
    } catch (error) { console.error('join protection', error); }
  });

  client.on(Events.GuildAuditLogEntryCreate, async (entry: GuildAuditLogsEntry, guild: Guild) => {
    try {
      const config = guildConfig(guild.id);
      if (!config.security.enabled || !protectedActions.has(entry.action) || !entry.executorId) return;
      if (entry.executorId === guild.ownerId || entry.executorId === client.user?.id || config.trustedIds.includes(entry.executorId)) return;
      const key = `${guild.id}:${entry.executorId}`;
      const count = record(audits, key, config.security.auditWindowSeconds * 1000);
      if (count !== config.security.auditLimit) return;
      const member = await guild.members.fetch(entry.executorId).catch(() => null);
      const result = member ? await punish(member, 'Guardian: массовые опасные действия', config.security.sanction) : 'участник не найден';
      await securityLog(guild, 'Защита от ньюка', `Исполнитель <@${entry.executorId}>: ${count} опасных действий за ${config.security.auditWindowSeconds} сек. Действие: ${result}. Последний тип: ${AuditLogEvent[entry.action] || entry.action}.`);
    } catch (error) { console.error('audit protection', error); }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (!message.guild || message.author.bot || !message.member) return;
      const config = guildConfig(message.guild.id);
      if (!config.security.enabled || config.trustedIds.includes(message.author.id) || message.author.id === message.guild.ownerId || message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
      const key = `${message.guild.id}:${message.author.id}`;
      const count = record(messages, key, config.security.spamWindowSeconds * 1000);
      if (count !== config.security.spamLimit) return;
      if (message.member.moderatable) await message.member.timeout(config.security.spamTimeoutMinutes * 60_000, 'Guardian: флуд');
      await securityLog(message.guild, 'Защита от флуда', `<@${message.author.id}>: ${count} сообщений за ${config.security.spamWindowSeconds} сек.`);
    } catch (error) { console.error('spam protection', error); }
  });
}
