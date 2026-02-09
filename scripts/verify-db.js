/**
 * データベース接続確認
 * 使用例: npm run db:verify
 * D1 利用時: USE_D1=1 で wrangler d1 execute --remote --command="SELECT 1 AS ok" を実行
 */

import 'dotenv/config';
import { spawnSync } from 'child_process';
import { query, closePool } from '../src/db.js';
import { getD1DatabaseName } from '../src/d1.js';

const USE_D1 = !!process.env.USE_D1;

async function main() {
  if (USE_D1) {
    const dbName = getD1DatabaseName();
    const result = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', dbName, '--remote', '--command="SELECT 1 AS ok"'],
      { cwd: process.cwd(), encoding: 'utf8', shell: true, windowsHide: true }
    );
    if (result.status !== 0) {
      console.error('接続失敗:', result.stderr || result.stdout);
      process.exit(1);
    }
    const out = (result.stdout || '').trim();
    if (out.includes('ok') || result.status === 0) {
      console.log('接続成功: D1 リモート（' + dbName + '）');
    } else {
      console.log('接続成功: D1 リモート（' + dbName + '）', out);
    }
    return;
  }
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
