import { createGameServer } from './src/app.js';

const PORT = Number(process.env.PORT) || 4000;
const { server } = createGameServer({ corsOrigin: process.env.CORS_ORIGIN || '*' });

server.listen(PORT, () => console.log(`Game server listening on port ${PORT}`));
