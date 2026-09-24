import { Redis } from 'ioredis';
import { config } from './config.js';

let client: Redis | null = null;

export async function connectRedis(retries = 30): Promise<Redis> {
  for (let i = 0; i < retries; i++) {
    try {
      client = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
      await client.ping();
      return client;
    } catch {
      client?.disconnect();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('redis did not become ready in time');
}

export function redis(): Redis {
  if (!client) throw new Error('redis not connected');
  return client;
}

/** Presence set key per document. */
export const presenceKey = (docId: string): string => `presence:${docId}`;
