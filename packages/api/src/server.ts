import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, waitForDatabase } from './db.js';
import { connectRedis } from './redis.js';
import { RealtimeGateway } from './realtime/RealtimeGateway.js';
import { seed } from './seed.js';

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await connectRedis();
  await seed();

  const app = await buildApp();
  app.log.level = process.env.LOG_LEVEL ?? 'info';
  await app.listen({ port: config.port, host: config.host });
  const gateway = new RealtimeGateway(app.server, config.autoVersionIntervalMs);
  void gateway;
  app.log.info(`api + realtime gateway listening on :${config.port}`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
