/**
 * 検索ページからカードID・基本情報を収集してDBに挿入する
 * 初期表示はスタンダードレギュレーション（検索条件でレギュレーションは指定しない）
 * 使用例:
 *   node scripts/collect-card-ids.js              … スタンダード（初期表示）で全ページ
 *   node scripts/collect-card-ids.js --pages=1    … 1ページ目のみ取得（pages＝検索結果のページネーション、1ページ≒39枚）
 *   node scripts/collect-card-ids.js --regulation=XY  … 指定レギュレーションのみ
 *   node scripts/collect-card-ids.js --all        … 全レギュレーション (XY, SM, S, SV)
 * 環境変数: PGHOST, PGUSER, PGPASSWORD, PGDATABASE または DATABASE_URL
 * D1 利用時: USE_D1=1, D1_DATABASE_NAME=pokeca（任意）
 */

import 'dotenv/config';
import { getPool, closePool, query } from '../src/db.js';
import { buildCardsUpsertSql, executeRemote } from '../src/d1.js';
import { fetchSearchResultPage } from '../src/services/scraper.js';
import { closeBrowser } from '../src/utils/browser.js';

const USE_D1 = !!process.env.USE_D1;

/** 現行レギュレーション（スタンダード＝SV） */
const CURRENT_REGULATION = 'SV';
const DEFAULT_REGULATION_LABEL = 'スタンダード（現行）';
const ALL_REGULATIONS = ['XY', 'SM', 'S', 'SV'];
const PAGE_DELAY_MS = 1500;

function parseArgs() {
  const all = process.argv.includes('--all');
  const regArg = process.argv.find((a) => a.startsWith('--regulation='));
  const regulation = regArg ? regArg.split('=')[1] : null;
  const pagesArg = process.argv.find((a) => a.startsWith('--pages='));
  const maxPages = pagesArg ? parseInt(pagesArg.split('=')[1], 10) : null;

  let regulations;
  if (all) {
    regulations = ALL_REGULATIONS;
  } else if (regulation && ALL_REGULATIONS.includes(regulation)) {
    regulations = [regulation];
  } else {
    regulations = [CURRENT_REGULATION];
  }
  return { regulations, maxPages: maxPages != null && !isNaN(maxPages) ? maxPages : null };
}

async function insertCard(client, card, regulation) {
  const sql = `
    INSERT INTO cards (card_id, name, full_name, category, image_url, detail_url, regulation, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    ON CONFLICT (card_id) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, cards.name),
      full_name = COALESCE(EXCLUDED.full_name, cards.full_name),
      category = COALESCE(EXCLUDED.category, cards.category),
      image_url = COALESCE(EXCLUDED.image_url, cards.image_url),
      detail_url = COALESCE(EXCLUDED.detail_url, cards.detail_url),
      regulation = COALESCE(cards.regulation, EXCLUDED.regulation),
      updated_at = CURRENT_TIMESTAMP
  `;
  await client.query(sql, [
    card.cardId,
    card.name || '',
    card.fullName || card.name || '',
    card.category || '不明',
    card.imageUrl || null,
    card.detailUrl || null,
    regulation
  ]);
}

async function main() {
  const { regulations, maxPages } = parseArgs();
  let pool = null;

  console.log('検索ページからカードIDを収集してDBに保存します。');
  if (USE_D1) {
    console.log('DB: Cloudflare D1（wrangler d1 execute）');
  } else {
    pool = getPool();
    try {
      await query('SELECT 1');
      let dbName = process.env.PGDATABASE || 'pokeca';
      if (process.env.DATABASE_URL) {
        try {
          const p = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
          if (p) dbName = p;
        } catch (_) {}
      }
      console.log('DB: PostgreSQL 接続OK（データベース:', dbName, '）');
    } catch (e) {
      console.error('DB接続エラー:', e.message);
      console.error('  .env の PGHOST, PGUSER, PGPASSWORD, PGDATABASE または DATABASE_URL を確認してください。');
      process.exit(1);
    }
  }
  console.log('レギュレーション:', regulations[0] === CURRENT_REGULATION && regulations.length === 1 ? DEFAULT_REGULATION_LABEL : regulations.join(', '));
  if (maxPages != null) {
    console.log('取得ページ数:', maxPages);
  }

  let totalInserted = 0;
  for (const regulation of regulations) {
    const regulationLabel = regulation === CURRENT_REGULATION && regulations.length === 1 ? DEFAULT_REGULATION_LABEL : regulation;
    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      if (maxPages != null && pageNum > maxPages) {
        hasMore = false;
        break;
      }
      console.log(`[${regulationLabel}] ページ ${pageNum} 取得中...`);
      let cards = [];
      try {
        cards = await fetchSearchResultPage(regulation, pageNum);
      } catch (err) {
        console.error(`[${regulationLabel}] ページ ${pageNum} エラー:`, err.message);
        break;
      }

      if (!cards || cards.length === 0) {
        console.warn(`[${regulationLabel}] ページ ${pageNum}: カードが1件も取得できませんでした。`);
        console.warn('  検索ページの構造変更やネットワーク、表示待ち時間の不足が考えられます。');
        console.warn('  デバッグ例: HEADLESS=false npm run db:collect-ids -- --pages=1');
        hasMore = false;
        break;
      }

      if (USE_D1) {
        const sql = buildCardsUpsertSql(cards, regulation);
        if (sql) executeRemote(sql);
        totalInserted += cards.length;
      } else {
        const client = await pool.connect();
        try {
          for (const card of cards) {
            await insertCard(client, card, regulation);
            totalInserted++;
          }
        } finally {
          client.release();
        }
      }

      console.log(`  -> ${cards.length} 件処理（累計 ${totalInserted} 件）`);
      if (maxPages != null && pageNum >= maxPages) {
        hasMore = false;
      } else if (cards.length < 50) {
        hasMore = false;
      } else {
        pageNum++;
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }
    }
  }

  await closeBrowser();
  if (!USE_D1) {
    await closePool();
  }
  console.log('完了。総処理件数:', totalInserted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
