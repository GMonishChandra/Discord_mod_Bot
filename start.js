
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Check data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Create default config if it doesn't exist
const configPath = path.join(dataDir, 'config.json');
if (!fs.existsSync(configPath)) {
  fs.writeFileSync(configPath, JSON.stringify({ token: 'MTQ1MTYwNjEyMzM4MjgzNzM4MA.GeGXbN.BbMzU6E0ZjreD5qvwl3aPfiPkKCtZuOciDbovA', anthropicKey: '' }, null, 2));
  console.log('\n  Created data/config.json — please add your bot token before running again!\n');
}

console.log(`
╔══════════════════════════════════════════╗
║         Powered by RTB Studios           ║
║         Starting up...                   ║
╚══════════════════════════════════════════╝
`);

// Start web server
require('./web/server.js');
