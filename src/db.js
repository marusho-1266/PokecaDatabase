/**
 * PostgreSQL接続（データベース構築・収集スクリプト用）
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pool = null;

/**
 * 接続設定を取得（環境変数またはデフォルト）
 */
function getConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'pokeca'
  };
}

/**
 * プールを取得（シングルトン）
 */
export function getPool() {
  if (!pool) {
    pool = new pg.Pool(getConfig());
  }
  return pool;
}

/**
 * クエリ実行
 */
export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * トランザクション実行
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * スキーマ（schema.sql）を実行
 */
export async function initSchema() {
  const schemaPath = join(__dirname, '..', 'database', 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');
  await query(sql);
}

/**
 * 接続を閉じる（スクリプト終了時）
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
