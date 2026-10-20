import {
  ChatInputCommandInteraction, Client, Events, MessageFlags,
  PermissionFlagsBits, Role,
} from 'discord.js';
import { guildConfig, updateGuild } from './state.js';
import { securityLog } from './security.js';

const protectedPermissions = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
];

function assignable(role: Role): boolean {
  return role.id !== role.guild.id && role.editable && !role.managed && !role.permissions.any(protectedPermissions);
}

export async function autoroleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: 'Нужно право «Управлять ролями» на сервере.', flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  if (sub === 'status') {
    const id = guildConfig(guild.id).autoroleRoleId;
    await interaction.reply({ content: id ? `Автороль: <@&${id}>.` : 'Автороль выключена.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (sub === 'off') {
    updateGuild(guild.id, config => { delete config.autoroleRoleId; });
    await interaction.reply({ content: 'Автороль выключена. Уже выданные роли остаются у участников.', flags: MessageFlags.Ephemeral });
    return;
  }
  const roleId = interaction.options.getRole('role', true).id;
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role || !assignable(role)) {
    await interaction.reply({ content: 'Бот должен иметь право управлять этой ролью и стоять выше неё. Административные и модераторские роли нельзя использовать как автороль.', flags: MessageFlags.Ephemeral });
    return;
  }
  const moderator = await guild.members.fetch(interaction.user.id);
  if (guild.ownerId !== moderator.id && role.comparePositionTo(moderator.roles.highest) >= 0) {
    await interaction.reply({ content: 'Вы можете назначить только роль ниже вашей самой высокой роли.', flags: MessageFlags.Ephemeral });
    return;
  }
  updateGuild(guild.id, config => { config.autoroleRoleId = role.id; });
  await interaction.reply({ content: `Теперь новые участники будут получать <@&${role.id}>. Уже вступившим участникам роль автоматически не выдаётся.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

export function installAutorole(client: Client): void {
  client.on(Events.GuildMemberAdd, async member => {
    try {
      const config = guildConfig(member.guild.id);
      const roleId = config.autoroleRoleId;
      if (!roleId || member.user.bot) return;
      const minAge = config.security.enabled ? config.security.minAccountAgeDays : 0;
      if (minAge && (Date.now() - member.user.createdTimestamp) / 86_400_000 < minAge) return;
      const role = await member.guild.roles.fetch(roleId).catch(() => null);
      if (!role || !assignable(role)) {
        await securityLog(member.guild, 'Ошибка автороли', `Роль ${roleId} недоступна для выдачи. Проверьте права и положение роли бота.`);
        return;
      }
      await member.roles.add(role, 'Guardian: автороль при входе');
    } catch (error) { console.error('autorole', error); }
  });
}
