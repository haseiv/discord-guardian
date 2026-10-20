import {
  ChannelType, ChatInputCommandInteraction, Client, Events, Message,
  MessageFlags, MessageReaction, PartialMessageReaction, PermissionFlagsBits, Role,
} from 'discord.js';
import { deleteReactionRoleMessage, putReactionRoleMessage, reactionRoleMessage, ReactionRoleMessage } from './state.js';

const ephemeral = { flags: MessageFlags.Ephemeral } as const;
const dangerousPermissions = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

function parseEmoji(value: string, guildEmojis: { cache: { has(id: string): boolean } }): { key: string; display: string; reactWith: string } | null {
  const trimmed = value.trim();
  const custom = /^<a?:[a-zA-Z0-9_]+:(\d{17,20})>$/.exec(trimmed);
  if (custom) return guildEmojis.cache.has(custom[1]) ? { key: custom[1], display: trimmed, reactWith: custom[1] } : null;
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 32 || /^\d{17,20}$/.test(trimmed)) return null;
  return { key: trimmed, display: trimmed, reactWith: trimmed };
}

function validRole(role: Role): boolean {
  return role.id !== role.guild.id && role.editable && !role.managed && !role.permissions.any(dangerousPermissions);
}

function content(record: ReactionRoleMessage): string {
  const lines = Object.values(record.roles).map(item => `${item.emoji} — <@&${item.roleId}>`);
  return `${record.text}\n\n${lines.join('\n')}\n\nНажмите на реакцию, чтобы получить роль. Уберите реакцию, чтобы снять её.`;
}

async function managedMessage(record: ReactionRoleMessage, client: Client): Promise<Message<true> | null> {
  const guild = client.guilds.cache.get(record.guildId);
  const channel = guild ? await guild.channels.fetch(record.channelId).catch(() => null) : null;
  if (channel?.type !== ChannelType.GuildText) return null;
  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  return message?.inGuild() && message.author.id === client.user?.id ? message : null;
}

export async function reactionRoleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'Нужно право «Управлять ролями» на сервере.', ...ephemeral }); return;
  }
  const sub = interaction.options.getSubcommand();
  const messageId = sub === 'create' ? null : interaction.options.getString('message_id', true);
  const existing = messageId ? reactionRoleMessage(messageId) : null;
  if (messageId && (!/^\d{17,20}$/.test(messageId) || !existing || existing.guildId !== guild.id)) {
    await interaction.reply({ content: 'Сообщение с ролями не найдено. Укажите ID сообщения, созданного через `/reaction-role create`.', ...ephemeral }); return;
  }
  if (sub === 'list') {
    await interaction.reply({ content: `Сообщение: https://discord.com/channels/${guild.id}/${existing!.channelId}/${existing!.messageId}\n${Object.values(existing!.roles).map(item => `${item.emoji} — <@&${item.roleId}>`).join('\n') || 'Привязок нет.'}`, ...ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  const input = interaction.options.getString('emoji', true);
  const emoji = parseEmoji(input, guild.emojis);
  if (!emoji) { await interaction.reply({ content: 'Укажите обычный эмодзи или доступный серверу кастомный эмодзи вида `<:name:id>`.', ...ephemeral }); return; }
  if (sub === 'remove') {
    if (!existing!.roles[emoji.key]) { await interaction.reply({ content: 'Для этого эмодзи нет роли.', ...ephemeral }); return; }
    await interaction.deferReply(ephemeral);
    const message = await managedMessage(existing!, interaction.client);
    if (!message) { deleteReactionRoleMessage(existing!.messageId); await interaction.editReply('Сообщение удалено или недоступно; привязки очищены.'); return; }
    delete existing!.roles[emoji.key];
    await message.edit({ content: content(existing!), allowedMentions: { parse: [] } });
    putReactionRoleMessage(existing!);
    const reaction = message.reactions.cache.find(item => (item.emoji.id || item.emoji.name) === emoji.key);
    if (reaction) await reaction.users.remove(interaction.client.user.id).catch(console.error);
    await interaction.editReply('Привязка удалена. Уже выданные роли остаются у участников.');
    return;
  }
  const role = interaction.options.getRole('role', true);
  const resolvedRole = await guild.roles.fetch(role.id).catch(() => null);
  if (!resolvedRole || !validRole(resolvedRole)) {
    await interaction.reply({ content: 'Эта роль недоступна: бот должен стоять выше неё и иметь право управлять ролями. Административные и модераторские роли нельзя раздавать по реакции.', ...ephemeral }); return;
  }
  const moderator = await guild.members.fetch(interaction.user.id);
  if (guild.ownerId !== moderator.id && resolvedRole.comparePositionTo(moderator.roles.highest) >= 0) {
    await interaction.reply({ content: 'Вы можете привязать только роль ниже вашей самой высокой роли.', ...ephemeral }); return;
  }
  if (sub === 'create') {
    const channelId = interaction.options.getChannel('channel', true).id;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.type !== ChannelType.GuildText) { await interaction.reply({ content: 'Текстовый канал недоступен.', ...ephemeral }); return; }
    if (!channel.permissionsFor(moderator)?.has(PermissionFlagsBits.ViewChannel)) { await interaction.reply({ content: 'У вас нет доступа к выбранному каналу.', ...ephemeral }); return; }
    const text = interaction.options.getString('text', true);
    const draft: ReactionRoleMessage = { guildId: guild.id, channelId: channel.id, messageId: '', text, roles: { [emoji.key]: { roleId: resolvedRole.id, emoji: emoji.display } } };
    if (content(draft).length > 2000) { await interaction.reply({ content: 'Текст сообщения слишком длинный.', ...ephemeral }); return; }
    await interaction.deferReply(ephemeral);
    const message = await channel.send({ content: content(draft), allowedMentions: { parse: [] } });
    try { await message.react(emoji.reactWith); }
    catch (error) { await message.delete().catch(console.error); throw error; }
    draft.messageId = message.id;
    putReactionRoleMessage(draft);
    await interaction.editReply(`Сообщение создано: https://discord.com/channels/${guild.id}/${channel.id}/${message.id}\nID: \`${message.id}\`. Добавьте другие роли через \`/reaction-role add\`.`);
    return;
  }
  if (existing!.roles[emoji.key]) { await interaction.reply({ content: 'Этот эмодзи уже используется в сообщении.', ...ephemeral }); return; }
  if (Object.values(existing!.roles).some(item => item.roleId === resolvedRole.id)) { await interaction.reply({ content: 'Эта роль уже привязана к другому эмодзи в сообщении.', ...ephemeral }); return; }
  if (Object.keys(existing!.roles).length >= 15) { await interaction.reply({ content: 'На одном сообщении можно разместить до 15 ролей.', ...ephemeral }); return; }
  const next = { ...existing!, roles: { ...existing!.roles, [emoji.key]: { roleId: resolvedRole.id, emoji: emoji.display } } };
  if (content(next).length > 2000) { await interaction.reply({ content: 'Достигнут лимит длины сообщения Discord.', ...ephemeral }); return; }
  await interaction.deferReply(ephemeral);
  const message = await managedMessage(existing!, interaction.client);
  if (!message) { deleteReactionRoleMessage(existing!.messageId); await interaction.editReply('Сообщение удалено или недоступно; привязки очищены.'); return; }
  await message.react(emoji.reactWith);
  try { await message.edit({ content: content(next), allowedMentions: { parse: [] } }); }
  catch (error) { const reaction = message.reactions.cache.find(item => (item.emoji.id || item.emoji.name) === emoji.key); if (reaction) await reaction.users.remove(interaction.client.user.id).catch(console.error); throw error; }
  putReactionRoleMessage(next);
  await interaction.editReply('Эмодзи и роль добавлены.');
}

async function onReaction(reaction: MessageReaction | PartialMessageReaction, user: { id: string; bot: boolean }, add: boolean): Promise<void> {
  if (user.bot) return;
  const record = reactionRoleMessage(reaction.message.id);
  if (!record || reaction.message.guildId !== record.guildId) return;
  const key = reaction.emoji.id || reaction.emoji.name;
  const mapped = key && record.roles[key];
  if (!mapped) return;
  const guild = reaction.client.guilds.cache.get(record.guildId);
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  const role = await guild.roles.fetch(mapped.roleId).catch(() => null);
  if (!member || !role || !validRole(role)) return;
  if (add && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Guardian: роль по реакции');
  if (!add && member.roles.cache.has(role.id)) await member.roles.remove(role, 'Guardian: реакция убрана');
}

export function installReactionRoles(client: Client): void {
  client.on(Events.MessageReactionAdd, (reaction, user) => { void onReaction(reaction, user, true).catch(error => console.error('reaction role add', error)); });
  client.on(Events.MessageReactionRemove, (reaction, user) => { void onReaction(reaction, user, false).catch(error => console.error('reaction role remove', error)); });
  client.on(Events.MessageDelete, message => { if (reactionRoleMessage(message.id)) deleteReactionRoleMessage(message.id); });
}
