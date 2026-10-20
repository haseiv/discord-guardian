import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { installInteractions } from './interactions.js';
import { installRooms } from './rooms.js';
import { installSecurity } from './security.js';
import { installReactionRoles } from './reaction-roles.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (!token || !clientId) throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env');

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
], partials: [Partials.Message, Partials.Channel, Partials.Reaction] });

installSecurity(client);
installInteractions(client);
installRooms(client);
installReactionRoles(client);
client.once(Events.ClientReady, ready => console.log(`Guardian online as ${ready.user.tag}`));
client.on(Events.Error, console.error);

async function start(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token!);
  const guildId = process.env.DISCORD_DEV_GUILD_ID;
  if (guildId) await rest.put(Routes.applicationGuildCommands(clientId!, guildId), { body: commands });
  else await rest.put(Routes.applicationCommands(clientId!), { body: commands });
  console.log(`Registered ${commands.length} ${guildId ? 'guild' : 'global'} command groups`);
  await client.login(token);
}
start().catch(error => { console.error(error); process.exitCode = 1; });
