'use strict';

// Node #61999 / Electron #52956: a delayed task can target a closed loop.
// Keep the entire redirect-limit fixture on loopback.
const http = require('node:http');
http
  .createServer((_request, response) => {
    response.writeHead(302, { Location: '/' });
    response.end();
  })
  .listen(0, '127.0.0.1', async function () {
    try {
      await fetch(`http://127.0.0.1:${this.address().port}/`);
    } catch {
      // Reaching the redirect limit is intentional.
    }
    process.stdout.write(JSON.stringify({ electron: process.versions.electron, completed: true }) + '\n');
    process.exit(0);
  });
