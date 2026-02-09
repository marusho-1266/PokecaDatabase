/**
 * Cloudflare D1 用ラッパー（wrangler d1 execute の子プロセス実行）
 * USE_D1 時に collect-card-ids / collect-details から利用する。
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const WRANGLER_BIN = join(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function getD1DatabaseName() {
  return process.env.D1_DATABASE_NAME || 'pokeca';
}

/** --command で渡す SQL の最大長（Windows コマンドライン制限を避ける）。これを超える場合は --file を使う */
const MAX_COMMAND_SQL_CHARS = 4000;

/**
 * wrangler d1 execute を同期実行する。
 * SELECT で --json を使う場合は --command で渡す（--file だと結果行が返らないため）。
 * 長い SQL は一時ファイル（--file）で実行する。
 * @param {string} sql - 実行する SQL（複数文は ; 区切り）
 * @param {{ json?: boolean }} options - json: true で --json を付与（SELECT 結果をパースする場合）
 * @returns {{ status: number, stdout: string, stderr: string, parsed?: unknown }}
 */
function runWranglerExecute(sql, options = {}) {
  const dbName = getD1DatabaseName();
  const useCommand = options.json && sql.length <= MAX_COMMAND_SQL_CHARS;
  let tmpPath = null;
  if (!useCommand) {
    tmpPath = join(tmpdir(), `wrangler-d1-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
    fs.writeFileSync(tmpPath, sql, 'utf8');
  }
  try {
    const args = [
      'wrangler', 'd1', 'execute', dbName,
      '--remote'
    ];
    if (useCommand) {
      args.push('--command', sql);
    } else {
      args.push('--file', tmpPath);
    }
    if (options.json) {
      args.push('--json');
    }
    const env = { ...process.env };
    if (process.platform === 'win32') {
      env.LANG = env.LANG || 'en';
      env.LC_ALL = env.LC_ALL || 'en';
    }
    const useWranglerBin = useCommand && fs.existsSync(WRANGLER_BIN);
    const exec = useWranglerBin ? process.execPath : 'npx';
    const execArgs = useWranglerBin ? [WRANGLER_BIN, 'd1', 'execute', dbName, '--remote', '--command', sql, ...(options.json ? ['--json'] : [])] : args;
    const result = spawnSync(exec, execArgs, {
      cwd: PROJECT_ROOT,
      encoding: process.platform === 'win32' ? null : 'utf8',
      shell: !useWranglerBin,
      env
    });
    let stdout = '';
    let stderr = '';
    if (process.platform === 'win32' && (result.stdout || result.stderr)) {
      try {
        stdout = result.stdout ? (Buffer.isBuffer(result.stdout) ? result.stdout.toString('cp932') : String(result.stdout)) : '';
        stderr = result.stderr ? (Buffer.isBuffer(result.stderr) ? result.stderr.toString('cp932') : String(result.stderr)) : '';
      } catch (_) {
        stdout = result.stdout ? result.stdout.toString() : '';
        stderr = result.stderr ? result.stderr.toString() : '';
      }
    } else {
      stdout = (result.stdout || '').toString();
      stderr = (result.stderr || '').toString();
    }
    const out = {
      status: result.status,
      stdout,
      stderr
    };
    if (options.json && out.stdout) {
      try {
        out.parsed = JSON.parse(out.stdout.trim());
      } catch (_) {
        out.parsed = null;
      }
    }
    return out;
  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
}

/**
 * SQL をリモート D1 で実行する（INSERT/UPDATE/DELETE 等）。複数文可。
 * @param {string} sql
 * @throws 実行失敗時
 */
export function executeRemote(sql) {
  const r = runWranglerExecute(sql);
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim();
    const dbName = getD1DatabaseName();
    const needsLogin = /認証|login|authentic|Unauthorized|credentials|required/i.test(msg);
    let hint = '';
    if (needsLogin) {
      hint = '\n→ Cloudflare にログインしてください: npx wrangler login';
    } else {
      hint = `\n→ 原因確認: 同じターミナルで「npx wrangler d1 execute ${dbName} --remote --command "SELECT 1"」を実行してエラー内容を確認してください。`;
    }
    throw new Error(`wrangler d1 execute failed (${r.status}): ${msg || '(no output)'}${hint}`);
  }
}

/**
 * SELECT をリモート D1 で実行し、結果行の配列を返す。--json でパースする。
 * @param {string} sql - 単一の SELECT 文を想定
 * @returns {Array<Record<string, unknown>>}
 */
export function queryRemote(sql) {
  const r = runWranglerExecute(sql, { json: true });
  if (r.status !== 0 && r.status !== null) {
    throw new Error(`wrangler d1 execute failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  if (r.status !== 0) {
    const msg = [r.stderr, r.stdout].filter(Boolean).join('\n') || '子プロセスが起動しませんでした（node で wrangler を直接実行しています）';
    throw new Error(`wrangler d1 execute failed: ${msg}`);
  }
  const data = r.parsed;
  if (!data) {
    return [];
  }
  // wrangler d1 execute --json (--command 時): [ { results: [行...], success, meta } ]
  let rows = [];
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === 'object' && Array.isArray(first.results)) {
      rows = first.results;
    } else if (first && typeof first === 'object' && !first.results) {
      rows = data;
    }
  } else if (data && typeof data === 'object') {
    if (Array.isArray(data.results)) {
      rows = data.results;
    } else if (Array.isArray(data.rows)) {
      rows = data.rows;
    }
  }
  return rows;
}

/**
 * SQL 文字列リテラル用のエスケープ（SQLite 規則）。
 * @param {string | number | null | undefined} val
 * @returns {string} - NULL の場合は "NULL"、数値はそのまま文字列で、文字列は '...' で囲む
 */
export function escapeSqlValue(val) {
  if (val === null || val === undefined) {
    return 'NULL';
  }
  if (typeof val === 'number' && !Number.isNaN(val)) {
    return String(val);
  }
  const s = String(val);
  const escaped = s.replace(/'/g, "''").replace(/\\/g, '\\\\');
  return `'${escaped}'`;
}

/**
 * 1 ページ分のカードを INSERT/ON CONFLICT DO UPDATE する SQL を生成する。
 * @param {Array<{ cardId: string, name?: string, fullName?: string, category?: string, imageUrl?: string, detailUrl?: string }>} cards
 * @param {string} regulation
 * @returns {string}
 */
export function buildCardsUpsertSql(cards, regulation) {
  if (!cards || cards.length === 0) {
    return '';
  }
  const statements = cards.map((card) => {
    const cardId = escapeSqlValue(card.cardId);
    const name = escapeSqlValue(card.name || '');
    const fullName = escapeSqlValue(card.fullName || card.name || '');
    const category = escapeSqlValue(card.category || '不明');
    const imageUrl = escapeSqlValue(card.imageUrl || null);
    const detailUrl = escapeSqlValue(card.detailUrl || null);
    const reg = escapeSqlValue(regulation);
    return `INSERT INTO cards (card_id, name, full_name, category, image_url, detail_url, regulation, updated_at)
VALUES (${cardId}, ${name}, ${fullName}, ${category}, ${imageUrl}, ${detailUrl}, ${reg}, datetime('now','localtime'))
ON CONFLICT (card_id) DO UPDATE SET
  name = COALESCE(excluded.name, cards.name),
  full_name = COALESCE(excluded.full_name, cards.full_name),
  category = COALESCE(excluded.category, cards.category),
  image_url = COALESCE(excluded.image_url, cards.image_url),
  detail_url = COALESCE(excluded.detail_url, cards.detail_url),
  regulation = COALESCE(cards.regulation, excluded.regulation),
  updated_at = datetime('now','localtime');`;
  });
  return statements.join('\n');
}

/** Windows のコマンドライン長制限（約8191文字）を避けるため、1回の execute で送る SQL の最大文字数目安 */
const D1_EXECUTE_CHUNK_CHARS = 6000;

/**
 * カード一覧を D1 に一括投入する。SQL が長くなりすぎないよう分割して executeRemote を複数回呼ぶ。
 * （Windows で --command の長さ制限により失敗するのを防ぐ）
 * @param {Array<{ cardId: string, name?: string, fullName?: string, category?: string, imageUrl?: string, detailUrl?: string }>} cards
 * @param {string} regulation
 */
export function executeRemoteCardsBatch(cards, regulation) {
  if (!cards || cards.length === 0) return;
  let chunk = [];
  let chunkChars = 0;
  for (const card of cards) {
    const sql = buildCardsUpsertSql([card], regulation);
    if (sql) {
      const len = sql.length;
      if (chunkChars + len > D1_EXECUTE_CHUNK_CHARS && chunk.length > 0) {
        executeRemote(buildCardsUpsertSql(chunk, regulation));
        chunk = [];
        chunkChars = 0;
      }
      chunk.push(card);
      chunkChars += len;
    }
  }
  if (chunk.length > 0) {
    executeRemote(buildCardsUpsertSql(chunk, regulation));
  }
}

/**
 * 1 枚分の詳細（UPDATE cards + DELETE/INSERT waza + abilities + 任意で collection_logs）を 1 本の SQL にまとめる。
 * @param {{ cardId: string, name?: string, fullName?: string, category?: string, imageUrl?: string, detailUrl?: string, type?: string, hp?: number, evolutionStage?: string, pokemonNumber?: string, weakness?: string, weaknessType?: string, weaknessValue?: string, resistance?: string, resistanceType?: string, resistanceValue?: string, retreatCost?: number, setName?: string, setCode?: string, cardNumber?: string, rarity?: string, illustrator?: string, effectText?: string, energySubtype?: string, waza?: Array<{ name?: string, nameClean?: string, damage?: number, damageModifier?: string, effect?: string, energyCost?: string[] }>, abilities?: Array<{ name?: string, effect?: string }> }} detail - getCardDetail の戻り値に相当するオブジェクト
 * @param {string} regulation
 * @param {{ cardId: string, status: string, source?: string, errorMessage?: string | null, processingTimeMs?: number } | null} logEntry - 同一次 execute に含める場合
 * @returns {string}
 */
export function buildDetailUpsertSql(detail, regulation, logEntry = null) {
  const e = escapeSqlValue;
  const cardId = detail.cardId;
  const cid = e(cardId);

  const parts = [];

  parts.push(`UPDATE cards SET
  name = COALESCE(${e(detail.name ?? null)}, name),
  full_name = COALESCE(${e(detail.fullName ?? null)}, full_name),
  category = COALESCE(${e(detail.category ?? null)}, category),
  image_url = COALESCE(${e(detail.imageUrl ?? null)}, image_url),
  detail_url = COALESCE(${e(detail.detailUrl ?? null)}, detail_url),
  card_type = COALESCE(${e(detail.type ?? null)}, card_type),
  hp = ${detail.hp != null ? Number(detail.hp) : 'NULL'},
  evolution_stage = COALESCE(${e(detail.evolutionStage ?? null)}, evolution_stage),
  pokemon_number = COALESCE(${e(detail.pokemonNumber ?? null)}, pokemon_number),
  weakness = COALESCE(${e(detail.weakness ?? null)}, weakness),
  weakness_type = COALESCE(${e(detail.weaknessType ?? null)}, weakness_type),
  weakness_value = COALESCE(${e(detail.weaknessValue ?? null)}, weakness_value),
  resistance = COALESCE(${e(detail.resistance ?? null)}, resistance),
  resistance_type = COALESCE(${e(detail.resistanceType ?? null)}, resistance_type),
  resistance_value = COALESCE(${e(detail.resistanceValue ?? null)}, resistance_value),
  retreat_cost = ${detail.retreatCost != null ? Number(detail.retreatCost) : 'NULL'},
  set_name = COALESCE(${e(detail.setName ?? null)}, set_name),
  set_code = COALESCE(${e(detail.setCode ?? null)}, set_code),
  card_number = COALESCE(${e(detail.cardNumber ?? null)}, card_number),
  rarity = COALESCE(${e(detail.rarity ?? null)}, rarity),
  illustrator = COALESCE(${e(detail.illustrator ?? null)}, illustrator),
  effect_text = COALESCE(${e(detail.effectText ?? null)}, effect_text),
  energy_subtype = COALESCE(${e(detail.energySubtype ?? null)}, energy_subtype),
  updated_at = datetime('now','localtime'),
  last_verified_at = datetime('now','localtime')
WHERE card_id = ${cid};`);

  parts.push(`DELETE FROM waza WHERE card_id = ${cid};`);
  parts.push(`DELETE FROM abilities WHERE card_id = ${cid};`);

  const wazaList = detail.waza || [];
  for (let i = 0; i < wazaList.length; i++) {
    const w = wazaList[i];
    parts.push(`INSERT INTO waza (card_id, name, name_clean, damage, damage_modifier, effect, order_index)
VALUES (${cid}, ${e(w.name || '')}, ${e(w.nameClean || '')}, ${w.damage != null ? Number(w.damage) : 'NULL'}, ${e(w.damageModifier ?? null)}, ${e(w.effect || '')}, ${i});`);
    const costs = w.energyCost || [];
    for (let j = 0; j < costs.length; j++) {
      parts.push(`INSERT INTO waza_energy_cost (waza_id, energy_type, order_index)
SELECT id, ${e(costs[j])}, ${j} FROM waza WHERE card_id = ${cid} AND order_index = ${i} LIMIT 1;`);
    }
  }

  const abilitiesList = detail.abilities || [];
  for (let i = 0; i < abilitiesList.length; i++) {
    const ab = abilitiesList[i];
    parts.push(`INSERT INTO abilities (card_id, name, effect, order_index)
VALUES (${cid}, ${e(ab.name || '')}, ${e(ab.effect || '')}, ${i});`);
  }

  if (logEntry) {
    parts.push(buildCollectionLogSql(logEntry));
  }

  return parts.join('\n');
}

/**
 * collection_logs への 1 行 INSERT SQL を生成する（エラー時など単体で記録する場合）。
 * @param {{ cardId: string, status: string, source?: string, errorMessage?: string | null, processingTimeMs?: number }}
 * @returns {string}
 */
export function buildCollectionLogSql(logEntry) {
  const e = escapeSqlValue;
  return `INSERT INTO collection_logs (card_id, status, source, error_message, processing_time_ms)
VALUES (${e(logEntry.cardId)}, ${e(logEntry.status)}, ${e(logEntry.source ?? null)}, ${e(logEntry.errorMessage ?? null)}, ${logEntry.processingTimeMs != null ? Number(logEntry.processingTimeMs) : 'NULL'});`;
}

export { getD1DatabaseName };
