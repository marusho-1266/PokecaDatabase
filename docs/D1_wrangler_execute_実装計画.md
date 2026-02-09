# wrangler d1 execute 利用による D1 対応 実装計画

## 方針

- **Cloudflare D1** を DB として利用する。
- 収集スクリプトからは **wrangler d1 execute** で D1（`--remote`）に SQL を送り、**1 枚分（または 1 ページ分）を 1 回の execute にまとめる**ことで無料枠の API レート制限（1,200 リクエスト/5 分）に余裕を持たせる。
- 収集スクリプトは公開しない。ローカル or 自前環境でのみ実行する前提。

---

# Part 1: Cloudflare D1 の構築手順

## 1.1 前提

- **Cloudflare アカウント**: [サインアップ](https://dash.cloudflare.com/sign-up/workers-and-pages)（Workers & Pages 用で可）。
- **Node.js**: 16.17.0 以上（wrangler の要件）。
- 本プロジェクトでは **Worker はデプロイしない**。D1 の作成と `wrangler d1 execute` による操作のみ行う。

## 1.2 wrangler の導入

プロジェクトで wrangler を利用するには、次のいずれかでよい。

**A. プロジェクトに devDependencies で入れる（推奨）**

```bash
npm install -D wrangler
```

- 実行時は `npx wrangler` または `npm exec wrangler` を使用する。
- `package.json` の `scripts` に `"d1:execute": "wrangler d1 execute pokeca --remote"` などを追加してもよい。

**B. グローバルインストール**

```bash
npm install -g wrangler
```

- どのディレクトリからも `wrangler` コマンドが使える。

## 1.3 Cloudflare へのログイン

初回のみ、ブラウザで認証する。

```bash
npx wrangler login
```

- ブラウザが開くので、Cloudflare アカウントでログインする。
- 成功するとローカルで wrangler が API を叩けるようになる。

## 1.4 D1 データベースの作成

**CLI で作成する場合**

1. プロジェクトルートで実行する。

```bash
npx wrangler d1 create pokeca
```

2. 成功すると、次のような出力が表示される。

```
✅ Successfully created DB 'pokeca' in region ...
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "pokeca",
      "database_id": "<<UUID>>"
    }
  ]
}
```

3. 表示された **database_name** と **database_id** を控える（次の 1.5 で使用）。

**ダッシュボードで作成する場合**

1. [D1 SQL database](https://dash.cloudflare.com/?to=/:account/workers/d1) を開く。
2. **Create Database** をクリック。
3. **Name** に `pokeca`（または任意の名前）を入力。
4. （任意）**Location hint** でリージョンを指定。
5. **Create** で作成。
6. 作成した DB を開き、**Settings** などで **Database ID**（UUID）を控える。

## 1.5 wrangler 設定ファイルの追加

プロジェクトルートに `wrangler.toml`（または `wrangler.jsonc`）を用意し、D1 の情報だけを書く。Worker はデプロイしないので、`main` や `name` は最小限でよい。

**wrangler.toml の例**

```toml
name = "pokeca-db"
# D1 のみ利用するため、Worker の main は未使用でもよい。execute には d1_databases だけ必要。
main = "src/server.js"

[[d1_databases]]
binding = "DB"
database_name = "pokeca"
database_id = "<<1.4 で控えた UUID>>"
```

- `database_name` は `wrangler d1 execute <名前>` で指定する名前と一致させる（上記なら `pokeca`）。
- `database_id` は 1.4 で取得した UUID に置き換える。

**注意**: `wrangler d1 execute` は、実行時にこのファイルの `d1_databases` から `database_name` で DB を特定する。Worker のデプロイは行わないので、`main` はダミーでよい。

## 1.6 スキーマの投入（リモート）

D1 用に変換したスキーマ（後述 Part 2）を用意したうえで、**リモート**の D1 に初回投入する。

```bash
npx wrangler d1 execute pokeca --remote --file=./database/schema-d1.sql
```

- 初回はテーブル・インデックス・FTS5 などが作成される。
- エラーが出た場合は、SQL の文法（SQLite 互換）と D1 の制限（例: 1 文あたり 100KB、パラメータ 100 個など）を確認する。

## 1.7 動作確認

リモート D1 にクエリを送って確認する。

```bash
npx wrangler d1 execute pokeca --remote --command="SELECT 1 AS ok"
```

- 正常なら `ok = 1` のような結果が表示される。
- テーブルがある場合は `SELECT COUNT(*) FROM cards` などでも確認できる。

## 1.8 まとめ（構築フロー）

| 順番 | 作業 | コマンド／作業内容 |
|------|------|---------------------|
| 1 | wrangler 導入 | `npm install -D wrangler` |
| 2 | ログイン | `npx wrangler login` |
| 3 | D1 作成 | `npx wrangler d1 create pokeca`（またはダッシュボードで作成） |
| 4 | 設定追記 | `wrangler.toml` に `[[d1_databases]]` を記載 |
| 5 | スキーマ投入 | `npx wrangler d1 execute pokeca --remote --file=./database/schema-d1.sql` |
| 6 | 確認 | `npx wrangler d1 execute pokeca --remote --command="SELECT 1"` |

---

# Part 2: 実装変更計画

## 2.1 変更対象の整理

| 対象 | 役割 | 変更内容 |
|------|------|----------|
| **database/schema.sql** | 現行（PostgreSQL 用） | そのまま残し、PostgreSQL 用として利用可能にする。 |
| **database/schema-d1.sql** | **新規** | D1（SQLite）用スキーマ。SERIAL→AUTOINCREMENT、全文検索→FTS5、GIN 削除など。 |
| **src/db.js** | 現行（pg Pool） | そのまま残す。D1 用スクリプトでは使わない。 |
| **src/d1.js** | **新規** | wrangler d1 execute のラッパー（子プロセス実行・SQL エスケープ・1 枚分バッチ生成など）。 |
| **scripts/collect-card-ids.js** | カード一覧収集 | pg の代わりに d1.js 経由で 1 ページ分の SQL をまとめて execute。 |
| **scripts/collect-details.js** | 詳細収集 | pg の代わりに d1.js 経由で 1 枚分の SQL を 1 回の execute にまとめて実行。 |
| **scripts/init-db.js** | スキーマ投入 | D1 モード時は `wrangler d1 execute ... --remote --file=./database/schema-d1.sql` を実行する分岐を追加（または別スクリプト init-d1.js）。 |
| **scripts/verify-db.js** | 接続確認 | D1 モード時は `wrangler d1 execute pokeca --remote --command="SELECT 1"` を実行する分岐を追加（または verify-d1.js）。 |
| **環境変数** | 接続先の切り替え | `USE_D1=true` および `D1_DATABASE_NAME=pokeca` などで D1 利用を指定。 |

## 2.2 スキーマの D1 用変換（schema-d1.sql）

- **ファイル**: `database/schema-d1.sql` を新規作成。
- **変更一覧**:
  - `SERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`（waza, waza_energy_cost, abilities, card_id_mapping, collection_logs）。
  - `VARCHAR(5)` → `TEXT`（SQLite ではそのままでも可）。
  - `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` → `TEXT DEFAULT (datetime('now','localtime'))` または `DEFAULT CURRENT_TIMESTAMP`（D1 は SQLite のためそのままでも動く場合あり。要確認）。
  - **全文検索**: `CREATE INDEX ... USING GIN(to_tsvector(...))` を削除。代わりに FTS5 仮想テーブルを追加。
    - 例: `CREATE VIRTUAL TABLE cards_fts USING fts5(name, full_name, content=cards, content_rowid=rowid);` および、`cards` の INSERT/UPDATE/DELETE 時に `cards_fts` を更新するトリガを定義。
    - または、検索をまだ使わない場合は FTS5 を後回しにし、通常の `LIKE` 検索のみでも可。
  - 部分インデックス `WHERE hp IS NULL` は SQLite でもそのまま記述可能。
  - 外部キー: SQLite ではデフォルトで OFF のため、必要なら `PRAGMA foreign_keys = ON;` をセッションで実行。D1 は実行コンテキストによるため、トリガで整合性を取るか、アプリ側で担保するかは検討。
- **実行順**: テーブル作成 → インデックス → FTS5 → トリガ（FTS5 を使う場合）。

## 2.3 共通モジュール src/d1.js の仕様

- **役割**:
  - `executeRemote(sql)`  
    `child_process.spawn`（または `execSync`）で `npx wrangler d1 execute <DB名> --remote --command="..."` を実行。  
    `sql` に複数文（`;` 区切り）を渡した場合、1 回の `--command` で流す（D1 の制限内に収める）。
  - `escapeSqlValue(val)`  
    SQL 文字列リテラル用のエスケープ（単一引用符のエスケープなど）。NULL は `NULL`、文字列は `'...'` で囲む。
  - **collect-card-ids 用**: 1 ページ分のカード配列を受け取り、1 本の SQL（複数 INSERT または UPSERT）にまとめて `executeRemote` で送る。
  - **collect-details 用**: 1 枚分の詳細オブジェクトを受け取り、UPDATE cards + DELETE waza/abilities + INSERT waza（複数）+ INSERT waza_energy_cost（サブクエリで waza.id 参照）+ INSERT abilities を 1 本の複数文 SQL にまとめて `executeRemote` で送る。
- **DB 名**: 環境変数 `D1_DATABASE_NAME`（既定値 `pokeca`）から取得。`wrangler.toml` の `database_name` と一致させる。
- **SQL 長制限**: D1 は 1 文あたりおおよそ 100KB まで。1 枚分・1 ページ分でそれを超えないようにする（超える場合は分割する方針をコメントで明記）。

## 2.4 collect-card-ids.js の変更

- **現状**: `getPool()` で pg に接続し、1 枚ごとに `insertCard(client, card, regulation)` で UPSERT。
- **変更後**:
  - 環境変数 `USE_D1` が truthy のときは D1 モードとする。
  - D1 モードでは、**1 ページ分のカードをまとめて** `d1.js` の「cards UPSERT 用 SQL 生成 + executeRemote」を呼ぶ。
  - SQL は SQLite の `INSERT INTO cards (...) VALUES (...)
ON CONFLICT(card_id) DO UPDATE SET ...` 形式にし、値は `escapeSqlValue` でエスケープして埋め込む。
  - ページごとに 1 回だけ `executeRemote` を呼ぶため、API リクエスト数は「ページ数」程度に抑えられる。
  - `USE_D1` が無い場合は従来どおり `src/db.js`（pg）を使用する。

## 2.5 collect-details.js の変更

- **現状**: `query()` で「hp IS NULL のカード」を取得し、1 枚ごとに `getCardDetail` でスクレイピング → `withTransaction` 内で UPDATE cards、DELETE waza/abilities、INSERT waza（RETURNING id）、INSERT waza_energy_cost、INSERT abilities。
- **変更後（D1 モード）**:
  - 「hp IS NULL のカード」の取得は、**wrangler d1 execute で SELECT を実行**し、標準出力をパースして card_id 一覧を取得する。または、**事前にローカルで一覧をファイルに吐いておく**など、別の方法でも可（まずは execute で SELECT 結果をパースする方針で計画）。
  - 1 枚ごとに `getCardDetail` でスクレイピングは同じ。
  - 1 枚分の保存は、**d1.js の「1 枚分詳細 SQL 生成」** を使う。
    - UPDATE cards SET ... WHERE card_id = '<escaped>';
    - DELETE FROM waza WHERE card_id = '<escaped>'; DELETE FROM abilities WHERE card_id = '<escaped>';
    - 各ワザについて:  
      `INSERT INTO waza (card_id, name, name_clean, damage, damage_modifier, effect, order_index) VALUES (...);`  
      続けて、そのワザのエネルギーコストについて:  
      `INSERT INTO waza_energy_cost (waza_id, energy_type, order_index)  
       SELECT id, '<escaped_type>', <j> FROM waza WHERE card_id = '<escaped>' AND order_index = <i> LIMIT 1;`  
      のようにサブクエリで waza.id を参照する。
    - 特性も同様に INSERT。
  - 上記を 1 本の複数文 SQL にまとめ、`executeRemote` を 1 回だけ呼ぶ。
  - collection_logs への INSERT も、同じ 1 回の execute に含めるか、別の 1 回 execute にする（含めると 1 枚 = 1 API リクエストで統一できる）。
  - `USE_D1` が無い場合は従来どおり pg を使用する。

## 2.6 init-db / verify-db の扱い

- **init-db.js**  
  - `USE_D1` 時: `wrangler d1 execute <D1_DATABASE_NAME> --remote --file=./database/schema-d1.sql` を子プロセスで実行。  
  - それ以外: 従来どおり `initSchema()`（pg + schema.sql）。
- **verify-db.js**  
  - `USE_D1` 時: `wrangler d1 execute <D1_DATABASE_NAME> --remote --command="SELECT 1 AS ok"` を実行し、出力に `ok` または成功メッセージが含まれるかで判定。  
  - それ以外: 従来どおり `query('SELECT current_database()...')`。

## 2.7 SQL エスケープと安全性

- ユーザー入力やスクレイピング結果をそのまま SQL に埋め込まない。必ず **escapeSqlValue** を通す。
- 文字列: 単一引用符 `'` を `''` にエスケープし、全体を `'...'` で囲む。
- 数値: 数値型として妥当な場合のみそのまま埋め込む。不明な場合は NULL またはデフォルト値に fallback。
- 改行・バックスラッシュなども SQLite のリテラル規則に合わせてエスケープする。

## 2.8 環境変数

| 変数 | 用途 | 既定値 |
|------|------|--------|
| `USE_D1` |  truthy のとき D1（wrangler execute）を使用 | 未設定なら pg |
| `D1_DATABASE_NAME` | wrangler d1 execute で指定する DB 名 | `pokeca` |
| （既存）`DATABASE_URL` / `PG*` | USE_D1 でないときの PostgreSQL 接続 | 従来どおり |

- `.env.example` に `USE_D1=false` と `D1_DATABASE_NAME=pokeca` の例を追記する。

## 2.9 フェーズ分け（実装順）

| フェーズ | 内容 | 成果物 |
|----------|------|--------|
| **Phase 1** | Cloudflare 側の準備とスキーマ | wrangler 導入、D1 作成、wrangler.toml、schema-d1.sql、リモートでのスキーマ投入・確認 |
| **Phase 2** | D1 用の共通層 | src/d1.js（executeRemote、escapeSqlValue、1 ページ分 cards SQL 生成、1 枚分 details SQL 生成） |
| **Phase 3** | 収集スクリプトの D1 対応 | collect-card-ids.js の USE_D1 分岐、collect-details.js の USE_D1 分岐（SELECT のパース含む） |
| **Phase 4** | init / verify とドキュメント | init-db.js / verify-db.js の D1 分岐、README や本ドキュメントへの実行手順の追記、.env.example 更新 |

## 2.10 テスト・確認項目

- D1 のみ: `USE_D1=1 node scripts/verify-db.js` でリモート D1 に SELECT が通ること。
- D1 のみ: `USE_D1=1 node scripts/init-db.js` で schema-d1.sql が流れ、テーブルが存在すること（既存ならエラーになる場合は DROP を考慮）。
- collect-card-ids: `USE_D1=1 node scripts/collect-card-ids.js --pages=1` で 1 ページ分が D1 に書き込まれること。`wrangler d1 execute pokeca --remote --command="SELECT COUNT(*) FROM cards"` で件数が増えていること。
- collect-details: `USE_D1=1 node scripts/collect-details.js --limit=1` で 1 枚分の詳細が D1 に反映され、waza / waza_energy_cost / abilities に期待どおり行が入ること。
- 既存の pg 運用: `USE_D1` を付けない場合、従来どおり PostgreSQL に書き込まれること。

---

## ドキュメント更新

- **README.md**: D1 を利用する場合の前提（wrangler、wrangler.toml、ログイン）と、`USE_D1=1` での init / verify / 収集の例を追記する。
- **docs/Cloudflare DBホスティング対応調査.md**: 本実装計画への参照を追記する。

以上が、wrangler d1 execute を利用する方針での実装変更計画と、Cloudflare D1 構築手順のまとめです。
