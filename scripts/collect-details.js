/**
 * cards テーブルにいるが詳細未取得のカードについて、詳細ページから取得して更新する
 * 使用例: node scripts/collect-details.js [--limit=50]
 * 環境変数: PGHOST, PGUSER, PGPASSWORD, PGDATABASE または DATABASE_URL
 * D1 利用時: USE_D1=1, D1_DATABASE_NAME=pokeca（任意）
 */

import 'dotenv/config';
import { query, withTransaction, closePool } from '../src/db.js';
import { queryRemote, buildDetailUpsertSql, buildCollectionLogSql, executeRemote } from '../src/d1.js';
import { getCardDetail } from '../src/services/cardDetail.js';
import { closeBrowser } from '../src/utils/browser.js';

const USE_D1 = !!process.env.USE_D1;
const REQUEST_DELAY_MS = 1200;
const DEFAULT_LIMIT = 50;

function parseArgs() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : DEFAULT_LIMIT;
  return { limit: isNaN(limit) ? DEFAULT_LIMIT : limit };
}

async function getCardsWithoutDetails(limit) {
  if (USE_D1) {
    const safeLimit = Math.max(1, Math.min(Number(limit), 500));
    const sql = `SELECT card_id, COALESCE(regulation, 'SV') AS regulation FROM cards WHERE hp IS NULL ORDER BY card_id LIMIT ${safeLimit}`;
    const rows = queryRemote(sql);
    return rows.map((r) => ({ card_id: r.card_id ?? r.cardId, regulation: r.regulation }));
  }
  const res = await query(
    `SELECT card_id, COALESCE(regulation, 'SV') AS regulation FROM cards WHERE hp IS NULL ORDER BY card_id LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function logResult(cardId, status, source, errorMessage, processingTimeMs) {
  await query(
    `INSERT INTO collection_logs (card_id, status, source, error_message, processing_time_ms) VALUES ($1, $2, $3, $4, $5)`,
    [cardId, status, source, errorMessage, processingTimeMs]
  );
}

async function updateCardAndWaza(client, detail, regulation) {
  const {
    cardId,
    name,
    fullName,
    category,
    imageUrl,
    detailUrl,
    type: cardType,
    hp,
    evolutionStage,
    pokemonNumber,
    weakness,
    weaknessType,
    weaknessValue,
    resistance,
    resistanceType,
    resistanceValue,
    retreatCost,
    setName,
    setCode,
    cardNumber,
    rarity,
    illustrator,
    effectText,
    energySubtype,
    waza,
    abilities
  } = detail;

  await client.query(
    `UPDATE cards SET
      name = COALESCE($2, name), full_name = COALESCE($3, full_name),
      category = COALESCE($4, category),
      image_url = COALESCE($5, image_url), detail_url = COALESCE($6, detail_url),
      card_type = COALESCE($7, card_type), hp = $8, evolution_stage = COALESCE($9, evolution_stage),
      pokemon_number = COALESCE($10, pokemon_number),
      weakness = $11, weakness_type = $12, weakness_value = $13,
      resistance = $14, resistance_type = $15, resistance_value = $16,
      retreat_cost = COALESCE($17, retreat_cost),
      set_name = $18, set_code = $19, card_number = $20, rarity = $21,
      illustrator = $22,
      effect_text = $23,
      energy_subtype = $24,
      updated_at = CURRENT_TIMESTAMP, last_verified_at = CURRENT_TIMESTAMP
    WHERE card_id = $1`,
    [
      cardId,
      name,
      fullName,
      category,
      imageUrl,
      detailUrl,
      cardType,
      hp,
      evolutionStage,
      pokemonNumber,
      weakness,
      weaknessType,
      weaknessValue,
      resistance,
      resistanceType,
      resistanceValue,
      retreatCost,
      setName,
      setCode,
      cardNumber,
      rarity,
      illustrator,
      effectText,
      energySubtype
    ]
  );

  await client.query(`DELETE FROM waza WHERE card_id = $1`, [cardId]);
  await client.query(`DELETE FROM abilities WHERE card_id = $1`, [cardId]);

  for (let i = 0; i < (waza || []).length; i++) {
    const w = waza[i];
    const wazaRes = await client.query(
      `INSERT INTO waza (card_id, name, name_clean, damage, damage_modifier, effect, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [cardId, w.name || '', w.nameClean || '', w.damage, w.damageModifier || null, w.effect || '', i]
    );
    const wazaId = wazaRes.rows[0].id;
    const costs = w.energyCost || [];
    for (let j = 0; j < costs.length; j++) {
      await client.query(
        `INSERT INTO waza_energy_cost (waza_id, energy_type, order_index) VALUES ($1, $2, $3)`,
        [wazaId, costs[j], j]
      );
    }
  }

  for (let i = 0; i < (abilities || []).length; i++) {
    const ability = abilities[i];
    await client.query(
      `INSERT INTO abilities (card_id, name, effect, order_index)
       VALUES ($1, $2, $3, $4)`,
      [cardId, ability.name || '', ability.effect || '', i]
    );
  }
}

async function main() {
  const { limit } = parseArgs();
  console.log(`詳細未取得カードを最大 ${limit} 件取得します。`);
  if (USE_D1) {
    console.log('DB: Cloudflare D1（wrangler d1 execute）');
  }

  const rows = await getCardsWithoutDetails(limit);
  if (rows.length === 0) {
    console.log('対象カードはありません。');
    if (!USE_D1) {
      await closePool();
    }
    return;
  }

  console.log(`${rows.length} 件を処理します。`);
  let ok = 0;
  let ng = 0;

  for (const row of rows) {
    const { card_id: cardId, regulation } = row;
    const regulationToUse = regulation || 'SV';
    const start = Date.now();

    try {
      const detail = await getCardDetail(cardId, regulationToUse);
      if (USE_D1) {
        const logEntry = { cardId, status: 'success', source: 'card_detail_page', errorMessage: null, processingTimeMs: Date.now() - start };
        const sql = buildDetailUpsertSql(detail, regulationToUse, logEntry);
        executeRemote(sql);
      } else {
        await withTransaction(async (client) => {
          await updateCardAndWaza(client, detail, regulationToUse);
        });
        await logResult(cardId, 'success', 'card_detail_page', null, Date.now() - start);
      }
      ok++;
      console.log(`  OK ${cardId} (${detail.name})`);
    } catch (err) {
      const processingTimeMs = Date.now() - start;
      if (USE_D1) {
        const logEntry = { cardId, status: 'error', source: 'card_detail_page', errorMessage: err.message, processingTimeMs };
        executeRemote(buildCollectionLogSql(logEntry));
      } else {
        await logResult(cardId, 'error', 'card_detail_page', err.message, processingTimeMs);
      }
      ng++;
      console.log(`  NG ${cardId}: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  await closeBrowser();
  if (!USE_D1) {
    await closePool();
  }
  console.log(`完了: 成功 ${ok}, 失敗 ${ng}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
