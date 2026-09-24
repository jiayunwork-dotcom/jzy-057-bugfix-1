import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function waitForDatabase(retries = 30, delayMs = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('database did not become ready in time');
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      pass_hash  TEXT NOT NULL,
      color      TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      owner_id   TEXT NOT NULL REFERENCES users(id),
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id          TEXT PRIMARY KEY,
      folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      owner_id    TEXT NOT NULL REFERENCES users(id),
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doc_members (
      doc_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role     TEXT NOT NULL,
      PRIMARY KEY (doc_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS doc_ops (
      doc_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      seq      BIGINT NOT NULL,
      op       JSONB NOT NULL,
      author   TEXT NOT NULL,
      PRIMARY KEY (doc_id, seq)
    );

    CREATE TABLE IF NOT EXISTS versions (
      id         TEXT PRIMARY KEY,
      doc_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      name       TEXT,
      op_offset  BIGINT NOT NULL,
      based_on   TEXT,
      author     TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         TEXT PRIMARY KEY,
      doc_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      quote      TEXT NOT NULL,
      anchor_idx INTEGER NOT NULL,
      status     TEXT NOT NULL DEFAULT 'anchored',
      thread_state TEXT NOT NULL DEFAULT 'open',
      author     TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_replies (
      id         TEXT PRIMARY KEY,
      comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ops_doc ON doc_ops(doc_id, seq);
    CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(doc_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_doc ON comments(doc_id);
  `);
}
