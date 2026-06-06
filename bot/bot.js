const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const express = require('express');

// Load config
const configPath = path.join(__dirname, '../data/config.json');
const warnPath = path.join(__dirname, '../data/warnings.json');
const badWordsPath = path.join(__dirname, '../data/badwords.json');
const eventsPath = path.join(__dirname, '../data/events.json');
const logsPath = path.join(__dirname, '../data/logs.txt');
const settingsPath = path.join(__dirname, '../data/settings.json');

function loadJSON(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) { fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2)); }
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Ensure data dir
if (!fs.existsSync(path.join(__dirname, '../data'))) fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });
if (!fs.existsSync(logsPath)) fs.writeFileSync(logsPath, '');

const config = loadJSON(configPath, { token: 'YOUR_BOT_TOKEN', anthropicKey: '' });
let settings = loadJSON(settingsPath, { aiEnabled: false });
let warnings = loadJSON(warnPath, {});
let badWords = loadJSON(badWordsPath, { words: [] });
let scheduledEvents = loadJSON(eventsPath, { events: [] });

// Global log buffer for web panel
let logBuffer = [];

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
  fs.appendFileSync(logsPath, line + '\n');
  // Broadcast to all log channels
  broadcastLog(line);
}

async function broadcastLog(line) {
  if (!client.isReady()) return;
  for (const guild of client.guilds.cache.values()) {
    const logChannel = guild.channels.cache.find(c => c.name === 'bot-logs' && c.type === ChannelType.GuildText);
    if (logChannel) {
      try { await logChannel.send(`\`${line}\``); } catch {}
    }
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
  ]
});

// Setup role and channel on guild join or restart
async function setupGuild(guild) {
  try {
    // Create or find "bot control" role
    let role = guild.roles.cache.find(r => r.name === 'bot control');
    if (!role) {
      role = await guild.roles.create({
        name: 'bot control',
        color: '#5865F2',
        reason: 'Bot control role',
      });
      log(`Created role "bot control" in ${guild.name}`);
    }

    // Create or find "bot-logs" channel
    let logChannel = guild.channels.cache.find(c => c.name === 'bot-logs' && c.type === ChannelType.GuildText);
    if (!logChannel) {
      logChannel = await guild.channels.create({
        name: 'bot-logs',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
        reason: 'Bot logs channel',
      });
      log(`Created #bot-logs channel in ${guild.name}`);
    }

    await logChannel.send(` **Bot online!** Use \`/help\` to see commands. Role: <@&${role.id}>`);
  } catch (err) {
    log(`Error setting up guild ${guild.name}: ${err.message}`);
  }
}

client.once('ready', async () => {
  log(`Bot logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    await setupGuild(guild);
  }
  // Start event scheduler
  startEventScheduler();
});

client.on('guildCreate', async (guild) => {
  log(`Joined new guild: ${guild.name}`);
  await setupGuild(guild);
});

// Message handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const prefix = '!';

  const bw = loadJSON(badWordsPath, { words: [] });
  for (const word of bw.words) {
    if (content.includes(word.toLowerCase())) {
      try { await message.delete(); } catch {}
      addWarning(message.guild?.id, message.author.id, `Used banned word: "${word}"`);
      const count = getWarnings(message.guild?.id, message.author.id);
      await message.channel.send(` <@${message.author.id}> your message was removed (banned word). Warnings: **${count}**`);
      log(`Bad word detected from ${message.author.tag} in ${message.guild?.name}`);
      return;
    }
  }

  const s = loadJSON(settingsPath, { aiEnabled: false });
  if (s.aiEnabled && message.mentions.has(client.user)) {
    const question = message.content.replace(/<@!?\d+>/g, '').trim();
    if (question) {
      await handleAI(message, question);
      return;
    }
  }

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Moderation commands 
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!ban @user [reason]`');
    const reason = args.slice(1).join(' ') || 'No reason';
    await target.ban({ reason });
    log(`${message.author.tag} banned ${target.user.tag} in ${message.guild.name}: ${reason}`);
    message.reply(` Banned **${target.user.tag}** | Reason: ${reason}`);
  }

  else if (command === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!kick @user [reason]`');
    const reason = args.slice(1).join(' ') || 'No reason';
    await target.kick(reason);
    log(`${message.author.tag} kicked ${target.user.tag} in ${message.guild.name}: ${reason}`);
    message.reply(` Kicked **${target.user.tag}** | Reason: ${reason}`);
  }

  else if (command === 'mute') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!mute @user [minutes]`');
    const mins = parseInt(args[1]) || 10;
    await target.timeout(mins * 60 * 1000, `Muted by ${message.author.tag}`);
    log(`${message.author.tag} muted ${target.user.tag} for ${mins}m in ${message.guild.name}`);
    message.reply(` Muted **${target.user.tag}** for **${mins} minutes**`);
  }

  else if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!unmute @user`');
    await target.timeout(null);
    log(`${message.author.tag} unmuted ${target.user.tag} in ${message.guild.name}`);
    message.reply(` Unmuted **${target.user.tag}**`);
  }

  else if (command === 'timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!timeout @user [minutes] [reason]`');
    const mins = parseInt(args[1]) || 5;
    const reason = args.slice(2).join(' ') || 'No reason';
    await target.timeout(mins * 60 * 1000, reason);
    log(`${message.author.tag} timed out ${target.user.tag} for ${mins}m: ${reason}`);
    message.reply(` Timed out **${target.user.tag}** for **${mins} minutes** | Reason: ${reason}`);
  }

  else if (command === 'warn') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!warn @user [reason]`');
    const reason = args.slice(1).join(' ') || 'No reason';
    addWarning(message.guild.id, target.user.id, reason);
    const count = getWarnings(message.guild.id, target.user.id);
    log(`${message.author.tag} warned ${target.user.tag} in ${message.guild.name}: ${reason}`);
    message.reply(` Warned **${target.user.tag}** | Reason: ${reason} | Total warnings: **${count}**`);
  }

  else if (command === 'warnings') {
    const target = message.mentions.members.first() || message.member;
    const count = getWarnings(message.guild.id, target.user.id);
    message.reply(` **${target.user.tag}** has **${count}** warning(s).`);
  }

  else if (command === 'clearwarnings') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply(' No permission.');
    const target = message.mentions.members.first();
    if (!target) return message.reply('Usage: `!clearwarnings @user`');
    clearWarnings(message.guild.id, target.user.id);
    log(`${message.author.tag} cleared warnings for ${target.user.tag}`);
    message.reply(` Cleared all warnings for **${target.user.tag}**`);
  }

  else if (command === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply(' No permission.');
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply('Usage: `!purge [1-100]`');
    await message.channel.bulkDelete(amount + 1, true);
    log(`${message.author.tag} purged ${amount} messages in ${message.guild.name}#${message.channel.name}`);
  }

  else if (command === 'slowmode') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(' No permission.');
    const seconds = parseInt(args[0]) || 0;
    await message.channel.setRateLimitPerUser(seconds);
    message.reply(` Slowmode set to **${seconds}s**`);
  }

  else if (command === 'lock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(' No permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    message.reply(' Channel locked.');
  }

  else if (command === 'unlock') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply(' No permission.');
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    message.reply(' Channel unlocked.');
  }

  else if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle(' Bot Commands')
      .setColor('#5865F2')
      .addFields(
        { name: ' Moderation', value: '`!ban` `!kick` `!mute` `!unmute` `!timeout` `!warn` `!warnings` `!clearwarnings` `!purge` `!slowmode` `!lock` `!unlock`' },
        { name: ' AI', value: 'Ping the bot to ask anything when AI is enabled from the web panel.' },
        { name: ' Panel', value: 'Control everything from the web panel at `http://localhost:3000`' }
      )
      .setFooter({ text: 'Web Panel Bot' });
    message.reply({ embeds: [embed] });
  }
});

//Warning helpers
function addWarning(guildId, userId, reason) {
  warnings = loadJSON(warnPath, {});
  if (!warnings[guildId]) warnings[guildId] = {};
  if (!warnings[guildId][userId]) warnings[guildId][userId] = [];
  warnings[guildId][userId].push({ reason, date: new Date().toISOString() });
  saveJSON(warnPath, warnings);
}
function getWarnings(guildId, userId) {
  warnings = loadJSON(warnPath, {});
  return (warnings[guildId]?.[userId] || []).length;
}
function clearWarnings(guildId, userId) {
  warnings = loadJSON(warnPath, {});
  if (warnings[guildId]) delete warnings[guildId][userId];
  saveJSON(warnPath, warnings);
}

// AI handler
async function handleAI(message, question) {
  const cfg = loadJSON(configPath, {});
  if (!cfg.anthropicKey) {
    return message.reply(" AI is enabled but no Anthropic API key is set. Add it in the web panel.");
  }
  try {
    await message.channel.sendTyping();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are a friendly, helpful Discord bot assistant. Respond casually and concisely like a human in a Discord server. Keep responses under 1900 characters.',
        messages: [{ role: 'user', content: question }]
      })
    });
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Sorry, I had trouble understanding that!';
    await message.reply(reply.slice(0, 1900));
    log(`AI response sent to ${message.author.tag}`);
  } catch (err) {
    log(`AI error: ${err.message}`);
    message.reply(" AI error. Check the web panel logs.");
  }
}

// Event Scheduler 
function startEventScheduler() {
  setInterval(async () => {
    const data = loadJSON(eventsPath, { events: [] });
    const now = Date.now();
    const remaining = [];
    for (const evt of data.events) {
      if (now >= new Date(evt.time).getTime()) {
        // Fire event
        try {
          const guild = client.guilds.cache.get(evt.guildId);
          if (guild) {
            const channel = guild.channels.cache.get(evt.channelId);
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle(evt.title)
                .setDescription(evt.description)
                .setColor('#FFD700')
                .setTimestamp();
              await channel.send({ embeds: [embed] });
              log(`Fired scheduled event: ${evt.title} in ${guild.name}`);
            }
          }
        } catch (err) {
          log(`Event error: ${err.message}`);
        }
      } else {
        remaining.push(evt);
      }
    }
    saveJSON(eventsPath, { events: remaining });
  }, 10000); // check every 10 seconds
}

// Export client for API server
module.exports = { client, log, logBuffer, loadJSON, saveJSON };

// Start bot
client.login(config.token).catch(err => {
  console.error('Failed to login:', err.message);
  console.error('set youre bot token in data/config.json');
});
