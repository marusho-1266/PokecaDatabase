/**
 * データベース初期化: schema.sql（PostgreSQL）または schema-d1.sql（D1）を実行してテーブルを作成する
 * 使用例: node scripts/init-db.js
 * D1 利用時: USE_D1=1 で wrangler d1 execute --remote --file=./database/schema-d1.sql を実行
 */

import 'dotenv/config';
import { spawnSync } from 'child_process';
import { initSchema, closePool } from '../src/db.js';
import { getD1DatabaseName } from '../src/d1.js';

const USE_D1 = !!process.env.USE_D1;

async function main() {
  console.log('データベースを初期化しています...');
  if (USE_D1) {
    const dbName = getD1DatabaseName();
    const result = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', dbName, '--remote', '--file=./database/schema-d1.sql'],
      { cwd: process.cwd(), encoding: 'utf8', shell: true }
    );
    if (result.status !== 0) {
      console.error('初期化エラー:', result.stderr || result.stdout);
      process.exit(1);
    }
    console.log('スキーマの作成が完了しました。（D1 リモート）');
    return;
  }
  try {
    await initSchema();
    console.log('スキーマの作成が完了しました。');
  } catch (err) {
    console.error('初期化エラー:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
