import { ChannelType, Client, Events, PermissionFlagsBits } from 'discord.js';
import { deleteRoom, guildConfig, putRoom, room, rooms, updateRoom } from './state.js';

export function installRooms(client: Client): void {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      if (oldState.channelId === newState.channelId) return;
      const guild = newState.guild;
      const config = guildConfig(guild.id).rooms;
      if (oldState.channelId && room(oldState.channelId)) {
        const previous = oldState.channel;
        const saved = room(oldState.channelId)!;
        if (previous?.type === ChannelType.GuildVoice) {
          if (!previous.members.size) {
            deleteRoom(previous.id);
            await previous.delete('Guardian: временная комната пуста').catch(console.error);
          } else if (saved.ownerId === oldState.id) {
            const next = previous.members.first();
            if (next) updateRoom(previous.id, r => { r.ownerId = next.id; });
          }
        }
      }
      if (!config.lobbyId || !config.categoryId || newState.channelId !== config.lobbyId || !newState.member) return;
      const member = newState.member;
      const existing = rooms().find(r => r.guildId === guild.id && r.ownerId === member.id);
      if (existing) {
        const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
        if (channel?.type === ChannelType.GuildVoice) { await member.voice.setChannel(channel); return; }
        deleteRoom(existing.channelId);
      }
      const channel = await guild.channels.create({
        name: `Комната ${member.user.username}`.slice(0, 100),
        type: ChannelType.GuildVoice, parent: config.categoryId, userLimit: config.defaultLimit,
        permissionOverwrites: [
          { id: guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
          { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
        ], reason: `Guardian room for ${member.id}`,
      });
      putRoom({ guildId: guild.id, channelId: channel.id, ownerId: member.id, createdAt: Date.now() });
      try { await member.voice.setChannel(channel); }
      catch (error) { deleteRoom(channel.id); await channel.delete('Guardian: не удалось переместить владельца').catch(console.error); throw error; }
    } catch (error) { console.error('voice room', error); }
  });
}
