const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wait for bot to be ready before requiring it
let botModule;
function getBot() {
  if (!botModule) botModule = require('../bot/bot.js');
  return botModule;
}

const dataDir = path.join(__dirname, '../data');
function dataPath(file) { return path.join(dataDir, file); }
function loadJSON(f, fb = {}) {
  try { return JSON.parse(fs.readFileSync(dataPath(f), 'utf8')); } catch { return fb; }
}
function saveJSON(f, d) { fs.writeFileSync(dataPath(f), JSON.stringify(d, null, 2)); }

// ── Logs ──────────────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  try {
    const { logBuffer } = getBot();
    res.json({ logs: logBuffer });
  } catch { res.json({ logs: [] }); }
});

app.get('/api/logs/download', (req, res) => {
  const p = dataPath('logs.txt');
  if (fs.existsSync(p)) res.download(p, 'bot-logs.txt');
  else res.status(404).json({ error: 'No logs yet' });
});

// ── Config / Settings ─────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const cfg = loadJSON('config.json', { token: '', anthropicKey: '' });
  res.json({ anthropicKey: cfg.anthropicKey ? '••••••••' : '', tokenSet: !!cfg.token });
});

app.post('/api/config', (req, res) => {
  const cfg = loadJSON('config.json', { token: '', anthropicKey: '' });
  if (req.body.token && req.body.token !== '••••••••') cfg.token = req.body.token;
  if (req.body.anthropicKey && req.body.anthropicKey !== '••••••••') cfg.anthropicKey = req.body.anthropicKey;
  saveJSON('config.json', cfg);
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
  res.json(loadJSON('settings.json', { aiEnabled: false }));
});

app.post('/api/settings', (req, res) => {
  const s = loadJSON('settings.json', { aiEnabled: false });
  Object.assign(s, req.body);
  saveJSON('settings.json', s);
  res.json({ success: true });
});

// ── Servers & Channels ────────────────────────────────────────────────────────
app.get('/api/servers', (req, res) => {
  try {
    const { client } = getBot();
    const servers = client.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL(),
      memberCount: g.memberCount
    }));
    res.json({ servers });
  } catch { res.json({ servers: [] }); }
});

app.get('/api/servers/:guildId/channels', (req, res) => {
  try {
    const { client } = getBot();
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const { ChannelType } = require('discord.js');
    const channels = guild.channels.cache
      .filter(c => c.type === ChannelType.GuildText)
      .map(c => ({ id: c.id, name: c.name }));
    res.json({ channels });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/servers/:guildId/members', (req, res) => {
  try {
    const { client } = getBot();
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const members = guild.members.cache
      .filter(m => !m.user.bot)
      .map(m => ({ id: m.user.id, tag: m.user.tag, username: m.user.username }));
    res.json({ members });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Send Messages ─────────────────────────────────────────────────────────────
app.post('/api/send/channel', async (req, res) => {
  const { guildIds, channelId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try {
    const { client, log } = getBot();
    const results = [];
    const ids = Array.isArray(guildIds) ? guildIds : [guildIds];
    for (const guildId of ids) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) { results.push({ guildId, error: 'Guild not found' }); continue; }
      const channel = guild.channels.cache.get(channelId) ||
        guild.channels.cache.find(c => c.id === channelId);
      if (!channel) { results.push({ guildId, error: 'Channel not found' }); continue; }
      await channel.send(message);
      log(`Panel sent message to ${guild.name}#${channel.name}`);
      results.push({ guildId, success: true, guild: guild.name, channel: channel.name });
    }
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/send/dm', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });
  try {
    const { client, log } = getBot();
    const user = await client.users.fetch(userId);
    await user.send(message);
    log(`Panel sent DM to ${user.tag}`);
    res.json({ success: true, user: user.tag });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bad Words ─────────────────────────────────────────────────────────────────
app.get('/api/badwords', (req, res) => {
  res.json(loadJSON('badwords.json', { words: [] }));
});

app.post('/api/badwords', (req, res) => {
  const { word } = req.body;
  if (!word) return res.status(400).json({ error: 'Word required' });
  const data = loadJSON('badwords.json', { words: [] });
  if (!data.words.includes(word.toLowerCase())) data.words.push(word.toLowerCase());
  saveJSON('badwords.json', data);
  res.json({ success: true, words: data.words });
});

app.delete('/api/badwords/:word', (req, res) => {
  const data = loadJSON('badwords.json', { words: [] });
  data.words = data.words.filter(w => w !== req.params.word.toLowerCase());
  saveJSON('badwords.json', data);
  res.json({ success: true, words: data.words });
});

// ── Warnings ──────────────────────────────────────────────────────────────────
app.get('/api/warnings', (req, res) => {
  res.json(loadJSON('warnings.json', {}));
});

// ── Scheduled Events ─────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(loadJSON('events.json', { events: [] }));
});

app.post('/api/events', (req, res) => {
  const { title, description, guildId, channelId, time } = req.body;
  if (!title || !guildId || !channelId || !time) return res.status(400).json({ error: 'Missing fields' });
  const data = loadJSON('events.json', { events: [] });
  const evt = { id: Date.now().toString(), title, description: description || '', guildId, channelId, time };
  data.events.push(evt);
  saveJSON('events.json', data);
  const { log } = getBot();
  log(`Scheduled event "${title}" for ${time}`);
  res.json({ success: true, event: evt });
});

app.delete('/api/events/:id', (req, res) => {
  const data = loadJSON('events.json', { events: [] });
  data.events = data.events.filter(e => e.id !== req.params.id);
  saveJSON('events.json', data);
  res.json({ success: true });
});

// ── Bot Status ────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  try {
    const { client } = getBot();
    res.json({
      online: client.isReady(),
      tag: client.user?.tag,
      guildCount: client.guilds.cache.size,
      uptime: client.uptime
    });
  } catch { res.json({ online: false }); }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n🌐 Web Panel running at http://localhost:${PORT}\n`);
});
