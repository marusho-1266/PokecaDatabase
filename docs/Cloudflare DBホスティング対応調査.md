# Cloudflare への DB ホスティング対応調査

## 前提・想定

- **Cloudflare に載せるのはデータベースだけ**とする。
- **収集スクリプト**（collect-card-ids / collect-details）は **公開しない**。ローカルまたは自前環境でのみ実行し、その結果を DB に書き込む運用を想定する。
- API（Express サーバー）を Workers 等に載せるかは別判断とする（本調査では「DB のみ Cloudflare」に焦点を当てる）。

---

## 概要

現在の構成は **PostgreSQL**（`pg` ドライバ・Express サーバー・Node スクリプト）です。**DB だけ** Cloudflare でホスティングする場合の選択肢と、それぞれで必要な対応をまとめました。

---

## Cloudflare の DB まわり（現状）

| サービス | 実体 | 用途 |
|----------|------|------|
| **D1** | SQLite（サーバーレス） | Workers/Pages からバインドで利用。Cloudflare がホスト。 |
| **Hyperdrive** | 接続プーラー | 外部の **PostgreSQL** に Workers から接続するための経路。DB そのものは Cloudflare ではない。 |

- **D1** … **DB を Cloudflare でホストする**場合の選択肢。Cloudflare がホストするのは D1（SQLite）のみなので、「DB だけ Cloudflare」の想定なら **D1 が該当**します。PostgreSQL ではなく SQLite のため、スキーマ・SQL・収集スクリプト側の接続方法の変更が必要です。
- **Hyperdrive** … 外部の **PostgreSQL**（Neon / Supabase / RDS 等）に Workers から接続するための経路。**DB そのものは Cloudflare 外**のため、「DB だけ Cloudflare に載せる」という要件には合いません。

以下、**DB を Cloudflare（D1）に載せる**方針を中心に、対応が必要なことを整理します。

---

## 現在の仕様サマリ

### 1. データベース

- **エンジン**: PostgreSQL
- **接続**: `src/db.js` で `pg`（node-postgres）の **Pool** を使用
- **設定**: `DATABASE_URL` または `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`
- **スキーマ**: `database/schema.sql`（PostgreSQL 専用の記述あり）

### 2. PostgreSQL 依存のスキーマ・SQL

| 箇所 | 内容 | 備考 |
|------|------|------|
| 主キー | `SERIAL PRIMARY KEY`（waza, waza_energy_cost, abilities, card_id_mapping, collection_logs） | D1(SQLite) の場合は `INTEGER PRIMARY KEY AUTOINCREMENT` 等に変更必要 |
| 全文検索 | `USING GIN(to_tsvector('simple', COALESCE(name,'') \|\| ' ' \|\| COALESCE(full_name,'')))` | D1 では GIN/to_tsvector 非対応。FTS5 仮想テーブル等で代替 |
| 条件付きインデックス | `WHERE hp IS NULL`（部分インデックス） | SQLite も部分インデックスは可能 |
| 挿入時の ID 取得 | `INSERT ... RETURNING id`（collect-details.js） | SQLite では `last_insert_rowid()` 等で対応 |
| UPSERT | `ON CONFLICT (card_id) DO UPDATE SET ...`（collect-card-ids.js） | SQLite 3.24+ で `INSERT ... ON CONFLICT` 対応済み |
| 接続確認 | `SELECT current_database(), current_user`（verify-db.js） | SQLite 用に別の確認クエリに変更 |

### 3. アプリ・スクリプトでの DB 利用

| 対象 | 役割 | DB 利用 |
|------|------|--------|
| **API**（`src/routes/cards.js`） | 検索・詳細 | 現状 **未使用**。`searchCards` / `getCardDetail` は公式サイトを Playwright でスクレイピング |
| **scripts/init-db.js** | スキーマ投入 | `initSchema()` で `schema.sql` をそのまま実行 |
| **scripts/verify-db.js** | 接続確認 | `query('SELECT current_database()...')` |
| **scripts/collect-card-ids.js** | 検索ページからカード一覧取得 | `getPool()`, `client.query()`（UPSERT） |
| **scripts/collect-details.js** | 詳細ページから取得して保存 | `query()`, `withTransaction()`, `client.query()`（UPDATE/DELETE/INSERT RETURNING id） |

### 4. その他

- **トランザクション**: `withTransaction()` で `BEGIN` / `COMMIT` / `ROLLBACK` を使用。
- **プレースホルダ**: すべて `$1`, `$2`（PostgreSQL 形式）。SQLite は `?` または `?1`, `?2`。
- **実行環境**: Express は常時起動の Node サーバー。収集スクリプトは Playwright 使用のため **ブラウザ起動可能な Node 環境** が必要。

---

## 方針別の対応一覧

### 方針: D1（SQLite）— 「DB だけ Cloudflare でホスト」（本想定に該当）

- **DB**: D1（Cloudflare ホストの SQLite）。**ここにのみ** Cloudflare を使う想定。
- **収集スクリプト**: 公開しない。**ローカル or 自前環境**で従来どおり Playwright を使って実行し、取得結果を **D1 に書き込む**。そのために D1 用スキーマ・D1 へ書き込むための接続方法（後述）への対応が必要。
- **API**: Cloudflare に載せるかは別判断。載せる場合は Workers/Pages から D1 バインドで参照する形になる。

#### 1. スキーマの D1(SQLite) 対応

- `SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`（または `INTEGER PRIMARY KEY` で ROWID 利用）
- `VARCHAR(n)` → `TEXT` でよい（SQLite は型がゆるい）
- `TIMESTAMP` → `TEXT`（ISO8601）または `INTEGER`（Unix time）。D1 の推奨に合わせる。
- 全文検索:  
  - GIN / `to_tsvector` を削除。  
  - 代わりに **FTS5** の仮想テーブル（例: `cards_fts`) を `cards` の `name` / `full_name` に対して作成し、検索時は `cards_fts MATCH ?` と JOIN する形に変更。
- `REFERENCES ... ON DELETE CASCADE` は SQLite でも利用可能（外部キーを有効にする必要あり）。
- 部分インデックス `WHERE hp IS NULL` は SQLite でも作成可能。

#### 2. SQL 文の変更

- プレースホルダ: `$1` → `?` または `?1`, `?2`（使用する D1 クライアントの仕様に合わせる）。
- `INSERT ... RETURNING id` → `INSERT ... ; SELECT last_insert_rowid()` または D1 API の返却値で ID 取得。
- `current_database()` / `current_user` → SQLite 用の確認クエリ（例: `SELECT 1`）に変更。

#### 3. 収集スクリプトから D1 へ書き込む方法（公開しない・ローカル実行前提）

収集スクリプトは Cloudflare にデプロイしないため、**ローカル等から D1 に書き込む**必要があります。

- **wrangler d1 execute**  
  ローカルで `wrangler d1 execute <DB名> --remote --file=./script.sql` や `--command="INSERT INTO ..."` で D1 に SQL を流す。収集スクリプト側で取得したデータを SQL 文字列またはファイルにし、子プロセスで wrangler を呼ぶ形にすると、既存の Playwright フローを活かしつつ D1 に反映できる。
- **D1 HTTP API（REST）**  
  Cloudflare API トークンで D1 の REST API を叩く。Node スクリプトから `fetch` で `POST .../client/v4/accounts/{account_id}/d1/database/{database_id}/query` にクエリを送る。プレースホルダは D1 の形式（`?1`, `?2` 等）に合わせる。
- **二段構成**  
  従来どおりローカルで PostgreSQL（またはローカル SQLite）に書き、別ジョブで D1 にエクスポート・同期する方法もあり。運用がやや増えるが、収集スクリプトの変更を最小にできる。

##### wrangler d1 execute と D1 HTTP API の比較

| 観点 | wrangler d1 execute | D1 HTTP API（Query） |
|------|----------------------|------------------------|
| **メリット** | ・CLI でそのまま使える。セットアップが簡単。<br>・`--file` で長い SQL やスキーマを一括実行しやすい。<br>・wrangler のログイン（`wrangler login`）だけでよく、**API トークンを別管理しなくてよい**。<br>・1 回の execute で複数文（`;` 区切り）を流せる（※ 文ごとの制限は D1 側の仕様に準拠）。 | ・Node スクリプト内で **`fetch` だけで完結**し、子プロセス不要。<br>・**パラメータ付きクエリ**（`?1`, `?2`）で値を渡せるため、SQL インジェクションを避けやすい。<br>・1 リクエスト 1 文だが、ループで連続実行するのに向く。<br>・CI や他サービスから「トークンだけ渡して D1 を叩く」構成にしやすい。 |
| **デメリット** | ・**子プロセスで wrangler を起動**する必要があり、オーバーヘッド・エラーハンドリングがやや重い。<br>・パラメータは **SQL 文字列に埋め込む**形になり、エスケープを自前でする必要がある（インジェクションに注意）。<br>・1 回の `--command` で渡せる SQL は **長さの制限**（目安として 100KB 前後）がある。<br>・wrangler のインストール・ログインができる環境が前提。 | ・**Cloudflare API のグローバルレート制限**の対象。多量のクエリを短時間に送ると制限に当たりやすい。<br>・**API トークン**（Account > D1 > Edit）の作成・保管が必要。<br>・1 クエリあたり **バインドパラメータは 100 個まで**、**SQL 文は 100KB まで** などの D1 制限にそのままはまる。<br>・管理用途向けの API のため、高頻度のアプリ用途には「Proxy Worker で D1 を叩く」構成が推奨されることがある。 |
| **向いている用途** | スキーマ投入、バッチ用 SQL ファイルの実行、収集結果を 1 ファイルにまとめて流すなど。 | 収集スクリプト内で「1 枚ずつ INSERT/UPDATE」のようにパラメータを渡して書きたい場合。 |

**実装のしやすさだけなら D1 HTTP API**

- **collect-card-ids.js**: 1 枚ごとにパラメータ付き UPSERT（7 引数）。wrangler だと SQL 文字列化・エスケープが増えて危険になりがち。
- **collect-details.js**: 1 枚ごとに UPDATE cards → DELETE → **INSERT waza RETURNING id** → その id で waza_energy_cost → INSERT abilities。**戻り値（id）を次の INSERT で使う**ので、レスポンスで結果が返る D1 HTTP API の方が素直に書ける。wrangler では `RETURNING id` をスクリプトで受け取れない。

##### 無料枠を前提にした場合

**無料枠の制限（目安）**

| 対象 | 無料枠の制限 |
|------|------------------|
| **D1** | 読み 500万行/日、**書き 10万行/日**、ストレージ 5GB。超過でクエリ拒否。 |
| **Cloudflare API**（D1 HTTP API や wrangler --remote が利用） | **1,200 リクエスト / 5 分**（トークン単位）。超過で 5 分間 429。 |

- D1 の「行数」は **API の呼び出し回数とは別**。1 回の INSERT で 10 行入れても 10 行とカウント。行数制限は wrangler / HTTP API どちらでも同じ。
- 違いが出るのは **Cloudflare API の 1,200 リクエスト/5 分** の方。

**D1 HTTP API の場合**

- **1 クエリ = 1 API リクエスト**。
- collect-details は 1 枚あたり 約 4（UPDATE + 2×DELETE + 1×INSERT waza）+ ワザ数×2 + 特性数 → **おおよそ 10〜20 リクエスト/枚**。  
  → 5 分で 60〜120 枚程度で 1,200 に達する。  
- 1 枚 1.2 秒ペースでも、**無料枠では 5 分あたりの API 制限が先に効く**可能性が高い。

**wrangler d1 execute の場合**

- **1 回の execute（`--command` や `--file`）で複数文を送れる**ため、**1 枚分を 1 回の execute = 1 API リクエスト**にまとめられる。
- collect-details の「INSERT waza の id を waza_energy_cost で使う」部分は、SQL 側で  
  `(SELECT id FROM waza WHERE card_id=? AND order_index=? LIMIT 1)` のようにサブクエリで参照する形にすれば、1 枚分を 1 つの複数文 SQL にできる。
- そうすると **1 枚 = 1 API リクエスト**になり、5 分で 1,200 枚分まで流してもレート制限に収まる（実際はスクレイピング遅延でそこまでにはならない）。
- デメリット: SQL の組み立てと値のエスケープを自前で行う必要がある。実装は D1 HTTP API より重い。

**結論（無料枠を最優先する場合）**

- **無料枠を最優先する**なら、**wrangler d1 execute で「1 枚分（または数枚分）を 1 回の execute にまとめる」**方が、API レート制限に当たりにくく有利。
- **実装の簡単さ・安全性（パラメータ付き・RETURNING の利用）を優先する**なら、これまでどおり **D1 HTTP API** を選び、収集量や実行時間を抑えて 1,200/5 分内に収める運用（例: 1 回の実行で 50 枚までなど）にする選択もある。

**補足**

- **大量一括投入**には、D1 の **Import API**（init → R2 アップロード → ingest → poll）を使う方法もある。REST の「Query」ではなく別エンドポイントで、大きな SQL を分割せずに流せる。
- どちらも D1 側の制限（1 文あたり 30 秒、パラメータ 100 個までなど）は共通でかかる。

いずれの場合も、**スキーマ・SQL は D1（SQLite）用に変換済み**である必要があります（上記 1・2 のとおり）。

#### 4. 運用

- マイグレーション: D1 用の `schema.sql`（または複数ファイル）を用意し、初回セットアップ・変更時は `wrangler d1 execute` 等で適用する。
- 収集: **Cloudflare には載せない**。ローカル or 自前サーバー/CI で実行し、その結果を上記のいずれかの方法で D1 に反映する。

---

### 参考: PostgreSQL を維持する場合（DB は Cloudflare 外）

「DB だけ Cloudflare」ではなく、**DB は従来どおり PostgreSQL のまま（Neon / Supabase / RDS 等）** にし、将来 API を Workers に載せる場合は **Hyperdrive** で接続する形になります。この場合、DB ホスティングは Cloudflare ではないため、本前提（DB だけ Cloudflare）からは外れます。

- スキーマ変更は不要。収集スクリプトは従来どおりローカル等から `DATABASE_URL` で PostgreSQL に接続して実行できる。

---

## 共通で検討したいこと

1. **収集スクリプトの実行**  
   収集スクリプトは公開しないため、**常にローカル or 自前環境**で実行。Playwright が必要なため Cloudflare 上では動かさない。取得結果は D1 用の書き込み方法（wrangler / D1 API / 二段構成）のいずれかで D1 に反映する。

2. **認証・ネットワーク**  
   - D1: Cloudflare の認証・ネットワークの枠内。  
   - Hyperdrive: 外部 PostgreSQL のファイアウォールで、Cloudflare の IP または Hyperdrive の egress を許可する必要がある場合あり。

3. **マイグレーション・バックアップ**  
   - D1: スキーマ変更は手動またはスクリプトで適用。Time Travel 等でリストア可能。  
   - 外部 PostgreSQL: 既存のバックアップ・PITR をそのまま利用可能。

---

## まとめ（DB だけ Cloudflare に載せる想定）

| 項目 | 内容 |
|------|------|
| **Cloudflare に載せるもの** | **データベース（D1）のみ**。収集スクリプト・API は公開/デプロイしない想定。 |
| **DB を Cloudflare でホストする選択肢** | **D1（SQLite）のみ**。PostgreSQL を Cloudflare がホストするサービスはない。 |
| **必要な対応** | スキーマの D1(SQLite) 対応（SERIAL→AUTOINCREMENT、全文検索→FTS5、プレースホルダ等）、収集スクリプトから D1 へ書き込む方法（wrangler d1 execute / D1 REST API / 二段構成のいずれか）の導入。 |
| **収集スクリプト** | 従来どおりローカル等で実行。その結果を D1 用の手順で D1 に反映する。公開しない前提のため Cloudflare へのデプロイは不要。 |
| **無料枠で書き込み経路を選ぶ場合** | Cloudflare API は 1,200 リクエスト/5 分。**無料枠を最優先するなら** wrangler d1 execute で 1 枚分を 1 回にまとめるとレート制限に当たりにくい。実装のしやすさを優先するなら D1 HTTP API + 実行量の調整。 |

「DB だけ Cloudflare」なら **D1** が該当し、スキーマの SQLite 化と「ローカル収集 → D1 への書き込み経路」の整備が対応の中心になります。

**wrangler d1 execute で書き込む方針での具体的な実装計画**は、[D1_wrangler_execute_実装計画.md](./D1_wrangler_execute_実装計画.md) にまとめてあります（Cloudflare D1 の構築手順とフェーズ別の変更内容を含む）。実装は同計画に沿って行われ、環境変数 `USE_D1=1` で収集・init/verify を D1 向けに切り替えられます。
