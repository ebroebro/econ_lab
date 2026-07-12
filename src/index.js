import { config } from './config.js';
import { db } from './db.js';
import { createServer } from './web/server.js';
import { startAgent } from './collectors/agent.js';

createServer(db).listen(config.port, () => {
  console.log(`대시보드: http://localhost:${config.port}`);
});
startAgent(db);
