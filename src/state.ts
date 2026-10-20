import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Sanction = 'ban' | 'kick' | 'strip';
export interface GuildConfig {
  logChannelId?: string;
  trustedIds: string[];
  security: {
    enabled: boolean;
    joinLimit: number;
    joinWindowSeconds: number;
    raidDurationMinutes: number;
    minAccountAgeDays: number;
    auditLimit: number;
    auditWindowSeconds: number;
    sanction: Sanction;
    spamLimit: number;
    spamWindowSeconds: number;
    spamTimeoutMinutes: number;
  };
  tickets: { categoryId?: string; staffRoleId?: string; logChannelId?: string };
  rooms: { lobbyId?: string; categoryId?: string; defaultLimit: number };
}
export interface Ticket { guildId: string; channelId: string; openerId: string; createdAt: number; }
export interface Room { guildId: string; channelId: string; ownerId: string; createdAt: number; }
export interface ReactionRoleMessage { guildId: string; channelId: string; messageId: string; text: string; roles: Record<string, { roleId: string; emoji: string }>; }
interface State { guilds: Record<string, GuildConfig>; tickets: Record<string, Ticket>; rooms: Record<string, Room>; reactionRoles: Record<string, ReactionRoleMessage>; }

const file = resolve(process.env.DATA_FILE || './data/state.json');
const empty = (): State => ({ guilds: {}, tickets: {}, rooms: {}, reactionRoles: {} });
let state: State = empty();
if (existsSync(file)) {
  state = { ...empty(), ...JSON.parse(readFileSync(file, 'utf8')) };
}
function save(): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}
export function guildConfig(id: string): GuildConfig {
  if (!state.guilds[id]) {
    state.guilds[id] = {
      trustedIds: [],
      security: {
        enabled: true, joinLimit: 8, joinWindowSeconds: 20,
        raidDurationMinutes: 10, minAccountAgeDays: 0,
        auditLimit: 3, auditWindowSeconds: 30, sanction: 'ban',
        spamLimit: 6, spamWindowSeconds: 8, spamTimeoutMinutes: 10,
      },
      tickets: {}, rooms: { defaultLimit: 0 },
    };
    save();
  }
  return state.guilds[id];
}
export function updateGuild(id: string, fn: (config: GuildConfig) => void): GuildConfig {
  const config = guildConfig(id);
  fn(config);
  save();
  return config;
}
export function ticket(id: string): Ticket | undefined { return state.tickets[id]; }
export function tickets(): Ticket[] { return Object.values(state.tickets); }
export function putTicket(value: Ticket): void { state.tickets[value.channelId] = value; save(); }
export function deleteTicket(id: string): void { delete state.tickets[id]; save(); }
export function room(id: string): Room | undefined { return state.rooms[id]; }
export function rooms(): Room[] { return Object.values(state.rooms); }
export function putRoom(value: Room): void { state.rooms[value.channelId] = value; save(); }
export function updateRoom(id: string, fn: (value: Room) => void): void { const value = room(id); if (value) { fn(value); save(); } }
export function deleteRoom(id: string): void { delete state.rooms[id]; save(); }
export function reactionRoleMessage(id: string): ReactionRoleMessage | undefined { return state.reactionRoles[id]; }
export function putReactionRoleMessage(value: ReactionRoleMessage): void { state.reactionRoles[value.messageId] = value; save(); }
export function deleteReactionRoleMessage(id: string): void { delete state.reactionRoles[id]; save(); }
