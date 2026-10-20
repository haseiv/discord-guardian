import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType,
  ChatInputCommandInteraction, Client, EmbedBuilder, Events,
  Interaction, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder,
  TextInputStyle, TextChannel, VoiceChannel,
} from 'discord.js';
import { deleteRoom, deleteTicket, guildConfig, putTicket, room, rooms, ticket, tickets, updateGuild, updateRoom } from './state.js';
import { autoroleCommand } from './autorole.js';

const privateReply = { flags: MessageFlags.Ephemeral } as const;
const ticketLocks = new Set<string>();
const roomButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder().setCustomId('room:rename').setLabel('Название').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('room:limit').setLabel('Лимит').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('room:lock').setLabel('Закрыть / открыть').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('room:delete').setLabel('Удалить пустую').setStyle(ButtonStyle.Danger),
);

async function ownRoom(interaction: Interaction): Promise<VoiceChannel | null> {
  const guild = interaction.guild;
  if (!guild) return null;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const channel = member?.voice.channel;
  return channel?.type === ChannelType.GuildVoice && room(channel.id)?.ownerId === interaction.user.id ? channel : null;
}
function safeName(value: string): string { return value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'room'; }
async function textChannel(interaction: ChatInputCommandInteraction): Promise<TextChannel> {
  const id = interaction.options.getChannel('channel', true).id;
  const channel = await interaction.guild!.channels.fetch(id);
  if (channel?.type !== ChannelType.GuildText) throw new Error('Text channel unavailable');
  return channel;
}

async function command(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === 'autorole') { await autoroleCommand(interaction); return; }
  const guild = interaction.guild;
  if (!guild) { await interaction.reply({ content: 'Команда доступна только на сервере.', ...privateReply }); return; }
  const sub = interaction.options.getSubcommand();
  if (interaction.commandName === 'guardian') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: 'Нужно право «Управлять сервером».', ...privateReply }); return; }
    if (sub === 'status') {
      const c = guildConfig(guild.id);
      await interaction.reply({ content: `**Защита:** ${c.security.enabled ? 'вкл' : 'выкл'}\n**Журнал:** ${c.logChannelId ? `<#${c.logChannelId}>` : 'не задан'}\n**Рейд:** ${c.security.joinLimit} входов / ${c.security.joinWindowSeconds} сек., таймаут ${c.security.raidDurationMinutes} мин.\n**Возраст аккаунта:** ${c.security.minAccountAgeDays} дн.\n**Антинюк:** ${c.security.auditLimit} действий / ${c.security.auditWindowSeconds} сек.; санкция ${c.security.sanction}\n**Флуд:** ${c.security.spamLimit} сообщений / ${c.security.spamWindowSeconds} сек.\n**Доверенные:** ${c.trustedIds.map(id => `<@${id}>`).join(', ') || 'нет'}`, ...privateReply });
      return;
    }
    updateGuild(guild.id, c => {
      if (sub === 'logs') c.logChannelId = interaction.options.getChannel('channel', true).id;
      if (sub === 'toggle') c.security.enabled = interaction.options.getBoolean('enabled', true);
      if (sub === 'raid') { c.security.joinLimit = interaction.options.getInteger('joins', true); c.security.joinWindowSeconds = interaction.options.getInteger('seconds', true); c.security.raidDurationMinutes = interaction.options.getInteger('timeout', true); }
      if (sub === 'account-age') c.security.minAccountAgeDays = interaction.options.getInteger('days', true);
      if (sub === 'antinuke') { c.security.auditLimit = interaction.options.getInteger('actions', true); c.security.auditWindowSeconds = interaction.options.getInteger('seconds', true); c.security.sanction = interaction.options.getString('sanction', true) as 'ban' | 'kick' | 'strip'; }
      if (sub === 'spam') { c.security.spamLimit = interaction.options.getInteger('messages', true); c.security.spamWindowSeconds = interaction.options.getInteger('seconds', true); c.security.spamTimeoutMinutes = interaction.options.getInteger('timeout', true); }
      if (sub === 'trust-add') { const id = interaction.options.getUser('user', true).id; if (!c.trustedIds.includes(id)) c.trustedIds.push(id); }
      if (sub === 'trust-remove') c.trustedIds = c.trustedIds.filter(id => id !== interaction.options.getUser('user', true).id);
    });
    await interaction.reply({ content: 'Настройки защиты сохранены.', ...privateReply });
    return;
  }
  if (interaction.commandName === 'tickets') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: 'Нужно право «Управлять сервером».', ...privateReply }); return; }
    if (sub === 'setup') {
      updateGuild(guild.id, c => { c.tickets.categoryId = interaction.options.getChannel('category', true).id; c.tickets.staffRoleId = interaction.options.getRole('staff', true).id; c.tickets.logChannelId = interaction.options.getChannel('log', true).id; });
      await interaction.reply({ content: 'Тикеты настроены. Используйте `/tickets panel`.', ...privateReply });
    } else {
      if (!guildConfig(guild.id).tickets.categoryId) { await interaction.reply({ content: 'Сначала `/tickets setup`.', ...privateReply }); return; }
      const channel = await textChannel(interaction);
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(interaction.options.getString('title') || 'Поддержка').setDescription(interaction.options.getString('description') || 'Нажмите кнопку, чтобы открыть приватный тикет.')], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('ticket:open').setLabel('Открыть тикет').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } });
      await interaction.reply({ content: `Панель размещена в <#${channel.id}>.`, ...privateReply });
    }
    return;
  }
  if (interaction.commandName === 'rooms') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: 'Нужно право «Управлять сервером».', ...privateReply }); return; }
    if (sub === 'setup') {
      updateGuild(guild.id, c => { c.rooms.lobbyId = interaction.options.getChannel('lobby', true).id; c.rooms.categoryId = interaction.options.getChannel('category', true).id; c.rooms.defaultLimit = interaction.options.getInteger('limit') ?? 0; });
      await interaction.reply({ content: 'Комнаты настроены. Используйте `/rooms panel`.', ...privateReply });
    } else {
      const config = guildConfig(guild.id).rooms;
      if (!config.lobbyId || !config.categoryId) { await interaction.reply({ content: 'Сначала `/rooms setup`.', ...privateReply }); return; }
      const channel = await textChannel(interaction);
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('Личные голосовые комнаты').setDescription(`Зайдите в <#${config.lobbyId}>: бот создаст комнату и перенесёт вас. Кнопки работают для владельца комнаты, в которой он находится. Команды: \`/room invite\`, \`/room transfer\`, \`/room kick\`.`)], components: [roomButtons], allowedMentions: { parse: [] } });
      await interaction.reply({ content: `Панель размещена в <#${channel.id}>.`, ...privateReply });
    }
    return;
  }
  if (interaction.commandName === 'room') {
    const channel = await ownRoom(interaction);
    if (!channel) { await interaction.reply({ content: 'Вы должны находиться в своей комнате.', ...privateReply }); return; }
    const user = interaction.options.getUser('user', true);
    if (sub === 'invite') await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true });
    if (sub === 'transfer' || sub === 'kick') {
      const target = await guild.members.fetch(user.id).catch(() => null);
      if (!target || target.voice.channelId !== channel.id || user.id === interaction.user.id) { await interaction.reply({ content: 'Выберите другого участника этой комнаты.', ...privateReply }); return; }
      if (sub === 'transfer') updateRoom(channel.id, r => { r.ownerId = user.id; });
      if (sub === 'kick') await target.voice.disconnect('Guardian: удалён владельцем комнаты');
    }
    await interaction.reply({ content: 'Готово.', ...privateReply });
    return;
  }
  if (interaction.commandName === 'publish') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) { await interaction.reply({ content: 'Нужно право «Управлять сообщениями».', ...privateReply }); return; }
    const channel = await textChannel(interaction);
    const member = await guild.members.fetch(interaction.user.id);
    if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages])) {
      await interaction.reply({ content: 'В выбранном канале нужны права просмотра и управления сообщениями.', ...privateReply }); return;
    }
    if (sub === 'text') await channel.send({ content: interaction.options.getString('content', true), allowedMentions: { parse: [] } });
    else {
      const embed = new EmbedBuilder().setTitle(interaction.options.getString('title', true)).setDescription(interaction.options.getString('description', true));
      const color = interaction.options.getString('color');
      if (color) { if (!/^#[0-9a-fA-F]{6}$/.test(color)) { await interaction.reply({ content: 'Цвет укажите как #RRGGBB.', ...privateReply }); return; } embed.setColor(parseInt(color.slice(1), 16)); }
      const image = interaction.options.getString('image');
      if (image) { try { if (new URL(image).protocol !== 'https:') throw new Error(); embed.setImage(image); } catch { await interaction.reply({ content: 'Картинка должна иметь HTTPS URL.', ...privateReply }); return; } }
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    await interaction.reply({ content: `Опубликовано в <#${channel.id}>.`, ...privateReply });
  }
}

async function openTicket(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  const key = `${guild.id}:${interaction.user.id}`;
  if (ticketLocks.has(key)) { await interaction.reply({ content: 'Тикет уже создаётся.', ...privateReply }); return; }
  ticketLocks.add(key);
  try {
    const config = guildConfig(guild.id).tickets;
    if (!config.categoryId || !config.staffRoleId) { await interaction.reply({ content: 'Тикеты ещё не настроены.', ...privateReply }); return; }
    const existing = tickets().find(t => t.guildId === guild.id && t.openerId === interaction.user.id);
    if (existing) { await interaction.reply({ content: `У вас уже есть тикет: <#${existing.channelId}>.`, ...privateReply }); return; }
    await interaction.deferReply(privateReply);
    const channel = await guild.channels.create({ name: `ticket-${safeName(interaction.user.username).toLowerCase()}`.slice(0, 90), type: ChannelType.GuildText, parent: config.categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ], reason: `Guardian ticket for ${interaction.user.id}` });
    putTicket({ guildId: guild.id, channelId: channel.id, openerId: interaction.user.id, createdAt: Date.now() });
    await channel.send({ content: `<@${interaction.user.id}> <@&${config.staffRoleId}>`, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Тикет открыт').setDescription('Опишите вопрос. Когда закончите, нажмите кнопку ниже.')], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('ticket:close').setLabel('Закрыть тикет').setStyle(ButtonStyle.Danger))], allowedMentions: { users: [interaction.user.id], roles: [config.staffRoleId] } });
    await interaction.editReply(`Тикет создан: <#${channel.id}>.`);
  } finally { ticketLocks.delete(key); }
}

async function closeTicket(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  const current = ticket(interaction.channelId);
  if (!current) { await interaction.reply({ content: 'Это не тикет.', ...privateReply }); return; }
  const staff = guildConfig(guild.id).tickets.staffRoleId;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (current.openerId !== interaction.user.id && !member?.permissions.has(PermissionFlagsBits.ManageChannels) && (!staff || !member?.roles.cache.has(staff))) {
    await interaction.reply({ content: 'Закрыть тикет может автор или поддержка.', ...privateReply }); return;
  }
  await interaction.deferReply(privateReply);
  const channel = await guild.channels.fetch(current.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) { deleteTicket(current.channelId); await interaction.editReply('Тикет уже удалён.'); return; }
  const lines: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    for (const message of batch.values()) lines.push(`${message.createdAt.toISOString()} ${message.author.tag}: ${message.content.replace(/\r?\n/g, ' ')} ${message.attachments.map(a => a.url).join(' ')}`);
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  const logId = guildConfig(guild.id).tickets.logChannelId;
  const log = logId ? await guild.channels.fetch(logId).catch(() => null) : null;
  if (log?.type === ChannelType.GuildText) await log.send({ content: `Тикет <#${channel.id}> (${channel.id}) от <@${current.openerId}> закрыт <@${interaction.user.id}>. Последние ${lines.length} сообщений.`, files: [{ attachment: Buffer.from(lines.reverse().join('\n') || 'Нет сообщений.', 'utf8'), name: `ticket-${channel.id}.txt` }], allowedMentions: { parse: [] } }).catch(console.error);
  deleteTicket(channel.id);
  await interaction.editReply('Тикет закрыт.');
  await channel.delete(`Guardian: closed by ${interaction.user.id}`);
}

async function button(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (interaction.customId === 'ticket:open') return openTicket(interaction);
  if (interaction.customId === 'ticket:close') return closeTicket(interaction);
  if (!interaction.customId.startsWith('room:')) return;
  const channel = await ownRoom(interaction);
  if (!channel) { await interaction.reply({ content: 'Вы должны находиться в своей комнате.', ...privateReply }); return; }
  if (interaction.customId === 'room:rename' || interaction.customId === 'room:limit') {
    const isName = interaction.customId === 'room:rename';
    await interaction.showModal(new ModalBuilder().setCustomId(isName ? 'room:rename:submit' : 'room:limit:submit').setTitle(isName ? 'Название комнаты' : 'Лимит участников').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('value').setLabel(isName ? 'Название' : 'Число от 0 до 99').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(isName ? 80 : 2))));
    return;
  }
  if (interaction.customId === 'room:lock') {
    const locked = channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(PermissionFlagsBits.Connect) ?? false;
    await channel.permissionOverwrites.edit(channel.guild.id, { Connect: locked ? null : false });
    await interaction.reply({ content: locked ? 'Комната открыта.' : 'Комната закрыта для новых входов.', ...privateReply });
  }
  if (interaction.customId === 'room:delete') {
    if (channel.members.size > 1) { await interaction.reply({ content: 'Сначала дождитесь выхода остальных участников.', ...privateReply }); return; }
    await interaction.reply({ content: 'Комната удалена.', ...privateReply });
    deleteRoom(channel.id);
    await channel.delete('Guardian: удалена владельцем');
  }
}

async function modal(interaction: Interaction): Promise<void> {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('room:')) return;
  const channel = await ownRoom(interaction);
  if (!channel) { await interaction.reply({ content: 'Вы должны находиться в своей комнате.', ...privateReply }); return; }
  const value = interaction.fields.getTextInputValue('value');
  if (interaction.customId === 'room:rename:submit') await channel.setName(safeName(value));
  if (interaction.customId === 'room:limit:submit') {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) { await interaction.reply({ content: 'Лимит должен быть числом от 0 до 99.', ...privateReply }); return; }
    await channel.setUserLimit(limit);
  }
  await interaction.reply({ content: 'Комната обновлена.', ...privateReply });
}

export function installInteractions(client: Client): void {
  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (interaction.isChatInputCommand()) await command(interaction);
      else if (interaction.isButton()) await button(interaction);
      else if (interaction.isModalSubmit()) await modal(interaction);
    } catch (error) {
      console.error('interaction', error);
      if (interaction.isRepliable()) {
        const message = { content: 'Не удалось выполнить действие. Проверьте права бота и настройки.', ...privateReply };
        if (interaction.deferred || interaction.replied) await interaction.followUp(message).catch(console.error);
        else await interaction.reply(message).catch(console.error);
      }
    }
  });
  client.on(Events.ChannelDelete, channel => {
    if (ticket(channel.id)) deleteTicket(channel.id);
    if (room(channel.id)) deleteRoom(channel.id);
  });
}
