/**
 * データベース接続確認
 * 使用例: npm run db:verify
 */

import 'dotenv/config';
import { query, closePool } from '../src/db.js';

async function main() {
  try {
    const res = await query('SELECT current_database() AS db, current_user AS "user"');
    const { db, user } = res.rows[0];
    console.log('接続成功:', { db, user });
  } catch (err) {
    console.error('接続失敗:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
