import { preview } from 'astro';

const port = 4329;
const server = await preview({ server: { host: '127.0.0.1', port } });
if (server.port !== port) {
  await server.stop();
  throw new Error('The starter preview port is unavailable. Use PLAYWRIGHT_BASE_URL instead.');
}
