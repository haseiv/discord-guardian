import 'dotenv/config';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { installInteractions } from './interactions.js';
import { installRooms } from './rooms.js';
import { installSecurity } from './security.js';
import { installAutorole } from './autorole.js';

const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '';
if (!token) throw new Error('Set DISCORD_TOKEN or DISCORD_BOT_TOKEN');

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
] });

installSecurity(client);
installAutorole(client);
installInteractions(client);
installRooms(client);
client.once(Events.ClientReady, ready => console.log(`Guardian online as ${ready.user.tag}`));
client.on(Events.Error, console.error);

async function start(): Promise<void> {
  await client.login(token);
  try {
    const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
    if (!clientId) throw new Error('Could not determine Discord application ID');
    const rest = new REST({ version: '10' }).setToken(token);
    const guildId = process.env.DISCORD_DEV_GUILD_ID;
    if (guildId) await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    else await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Registered ${commands.length} ${guildId ? 'guild' : 'global'} command groups`);
  } catch (error) {
    client.destroy();
    throw error;
  }
}
start().catch(error => { console.error(error); process.exitCode = 1; });
