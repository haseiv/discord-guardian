import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('guardian').setDescription('Общие настройки защиты')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('status').setDescription('Показать настройки'))
    .addSubcommand(s => s.setName('logs').setDescription('Канал журнала защиты').addChannelOption(o => o.setName('channel').setDescription('Текстовый канал').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('toggle').setDescription('Включить или выключить защиту').addBooleanOption(o => o.setName('enabled').setDescription('Включена').setRequired(true)))
    .addSubcommand(s => s.setName('raid').setDescription('Порог массового входа').addIntegerOption(o => o.setName('joins').setDescription('Число входов, 2–100').setMinValue(2).setMaxValue(100).setRequired(true)).addIntegerOption(o => o.setName('seconds').setDescription('Окно, 5–300 секунд').setMinValue(5).setMaxValue(300).setRequired(true)).addIntegerOption(o => o.setName('timeout').setDescription('Таймаут, 1–60 минут').setMinValue(1).setMaxValue(60).setRequired(true)))
    .addSubcommand(s => s.setName('account-age').setDescription('Минимальный возраст аккаунта').addIntegerOption(o => o.setName('days').setDescription('0 выключает; 0–365 дней').setMinValue(0).setMaxValue(365).setRequired(true)))
    .addSubcommand(s => s.setName('antinuke').setDescription('Порог опасных действий').addIntegerOption(o => o.setName('actions').setDescription('Число действий, 2–30').setMinValue(2).setMaxValue(30).setRequired(true)).addIntegerOption(o => o.setName('seconds').setDescription('Окно, 5–300 секунд').setMinValue(5).setMaxValue(300).setRequired(true)).addStringOption(o => o.setName('sanction').setDescription('Наказание').addChoices({ name: 'Бан', value: 'ban' }, { name: 'Кик', value: 'kick' }, { name: 'Снять роли и таймаут', value: 'strip' }).setRequired(true)))
    .addSubcommand(s => s.setName('spam').setDescription('Порог флуда').addIntegerOption(o => o.setName('messages').setDescription('Сообщений, 2–30').setMinValue(2).setMaxValue(30).setRequired(true)).addIntegerOption(o => o.setName('seconds').setDescription('Окно, 2–60 секунд').setMinValue(2).setMaxValue(60).setRequired(true)).addIntegerOption(o => o.setName('timeout').setDescription('Таймаут, 1–60 минут').setMinValue(1).setMaxValue(60).setRequired(true)))
    .addSubcommand(s => s.setName('trust-add').setDescription('Добавить доверенного').addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true)))
    .addSubcommand(s => s.setName('trust-remove').setDescription('Удалить доверенного').addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))),
  new SlashCommandBuilder().setName('tickets').setDescription('Настройка и управление тикетами')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Указать категорию, роль поддержки и журнал').addChannelOption(o => o.setName('category').setDescription('Категория тикетов').addChannelTypes(ChannelType.GuildCategory).setRequired(true)).addRoleOption(o => o.setName('staff').setDescription('Роль поддержки').setRequired(true)).addChannelOption(o => o.setName('log').setDescription('Канал закрытых тикетов').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('panel').setDescription('Разместить панель тикетов').addChannelOption(o => o.setName('channel').setDescription('Текстовый канал').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o => o.setName('title').setDescription('Заголовок панели')).addStringOption(o => o.setName('description').setDescription('Описание панели'))),
  new SlashCommandBuilder().setName('rooms').setDescription('Настройка временных голосовых комнат')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Указать вход и категорию').addChannelOption(o => o.setName('lobby').setDescription('Голосовой вход').addChannelTypes(ChannelType.GuildVoice).setRequired(true)).addChannelOption(o => o.setName('category').setDescription('Категория новых комнат').addChannelTypes(ChannelType.GuildCategory).setRequired(true)).addIntegerOption(o => o.setName('limit').setDescription('Лимит участников, 0–99').setMinValue(0).setMaxValue(99)))
    .addSubcommand(s => s.setName('panel').setDescription('Разместить панель управления комнатой').addChannelOption(o => o.setName('channel').setDescription('Текстовый канал').addChannelTypes(ChannelType.GuildText).setRequired(true))),
  new SlashCommandBuilder().setName('room').setDescription('Управление своей голосовой комнатой')
    .addSubcommand(s => s.setName('invite').setDescription('Открыть доступ пользователю').addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true)))
    .addSubcommand(s => s.setName('transfer').setDescription('Передать владение').addUserOption(o => o.setName('user').setDescription('Участник комнаты').setRequired(true)))
    .addSubcommand(s => s.setName('kick').setDescription('Отключить участника от комнаты').addUserOption(o => o.setName('user').setDescription('Участник комнаты').setRequired(true))),
  new SlashCommandBuilder().setName('publish').setDescription('Отправить сообщение от имени бота')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('text').setDescription('Обычное сообщение').addChannelOption(o => o.setName('channel').setDescription('Текстовый канал').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o => o.setName('content').setDescription('Текст до 2000 символов').setMaxLength(2000).setRequired(true)))
    .addSubcommand(s => s.setName('embed').setDescription('Эмбед сообщение').addChannelOption(o => o.setName('channel').setDescription('Текстовый канал').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(o => o.setName('title').setDescription('Заголовок').setMaxLength(256).setRequired(true)).addStringOption(o => o.setName('description').setDescription('Текст').setMaxLength(4000).setRequired(true)).addStringOption(o => o.setName('color').setDescription('Цвет #RRGGBB')).addStringOption(o => o.setName('image').setDescription('URL картинки'))),
  new SlashCommandBuilder().setName('autorole').setDescription('Автоматическая роль новым участникам')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('set').setDescription('Выдавать роль при входе').addRoleOption(o => o.setName('role').setDescription('Роль для новых участников').setRequired(true)))
    .addSubcommand(s => s.setName('off').setDescription('Отключить автороль'))
    .addSubcommand(s => s.setName('status').setDescription('Показать текущую автороль')),
].map(command => command.toJSON());
