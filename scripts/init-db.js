/**
 * データベース初期化: schema.sql を実行してテーブルを作成する
 * 使用例: node scripts/init-db.js
 */

import 'dotenv/config';
import { initSchema, closePool } from '../src/db.js';

async function main() {
  console.log('データベースを初期化しています...');
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
