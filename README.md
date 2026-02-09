# ポケモンカードデータベース構築手順

PostgreSQL でカードDBを作成し、公式サイトから詳細情報を収集する手順です。UIは不要で、CLIスクリプトのみで運用できます。

---

## アプリから DB 接続手順（まとめ）

アプリ（Express サーバー・収集スクリプト）から PostgreSQL に接続するまでの手順です。

### Step 1: 依存関係のインストール

```bash
cd server
npm install
```

`pg` と `dotenv` は `package.json` に含まれています。

### Step 2: データベースの作成（未作成の場合）

PostgreSQL でデータベース `pokeca` がまだなければ作成します。

```bash
psql -U postgres -c "CREATE DATABASE pokeca;"
```

（Windows の場合は `psql -U postgres` でログイン後、`CREATE DATABASE pokeca;` を実行しても構いません。）

### Step 3: 環境変数ファイルの作成

1. `server/.env.example` を `server/.env` にコピーします。

   ```bash
   cd server
   cp .env.example .env
   ```

   （Windows のコマンドプロンプト: `copy .env.example .env`）

2. `.env` を開き、PostgreSQL の接続情報を自分の環境に合わせて編集します。

   **方法A: 個別指定**

   ```env
   PGHOST=localhost
   PGPORT=5432
   PGUSER=postgres
   PGPASSWORD=あなたのパスワード
   PGDATABASE=pokeca
   ```

   **方法B: 接続文字列で1行で指定**

   ```env
   DATABASE_URL=postgresql://postgres:あなたのパスワード@localhost:5432/pokeca
   ```

   - パスワードに `@` や `#` を含む場合は URL エンコードするか、方法Aを使ってください。
   - `.env` は git にコミットしないでください（通常は `.gitignore` に含まれています）。

### Step 4: 接続の確認

次のいずれかで接続できていれば成功です。

**A. スキーマ初期化（テーブルがまだない場合）**

```bash
cd server
npm run db:init
```

「スキーマの作成が完了しました。」と表示されれば接続できています。既にテーブルがある場合はエラーになることがあるので、そのときは **B** で確認してください。

**B. 接続確認スクリプト（推奨）**

```bash
cd server
npm run db:verify
```

「接続成功: { db: 'pokeca', user: 'postgres' }」のように表示されれば OK です。

### Step 5: アプリの起動

```bash
cd server
npm run dev
```

サーバーは `http://localhost:3001` で起動します。検索API（`/api/cards/search` など）は現状はまだ**公式サイトのスクレイピング**を使用しています。DB に保存したデータで検索するAPIに切り替えるのは今後の実装になります。収集スクリプト（`npm run db:collect-ids` / `npm run db:collect-details`）は既にこの DB に接続して利用します。

---

## 1. 前提

- PC に PostgreSQL をインストール済み
- Node.js 16 以上
- `server/` で `npm install` 済みであること

## 2. データベースの作成

PostgreSQL にログインして、空のデータベースを作成します。

```bash
# 例: ユーザー postgres でログインして DB 作成
psql -U postgres -c "CREATE DATABASE pokeca;"
```

作成するDB名は後述の環境変数 `PGDATABASE` で指定できます（デフォルトは `pokeca`）。

## 3. 環境変数

`server/.env` を作成し、次のいずれかの方法で設定します。

**方法A: 個別指定**

```env
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=あなたのパスワード
PGDATABASE=pokeca
```

**方法B: 接続文字列**

```env
DATABASE_URL=postgresql://postgres:パスワード@localhost:5432/pokeca
```

## 4. テーブル作成（スキーマの初期化）

```bash
cd server
npm run db:init
```

`server/database/schema.sql` が実行され、`cards`, `waza`, `waza_energy_cost`, `abilities`, `card_id_mapping`, `collection_logs` が作成されます。

## 5. カードIDの収集（検索ページから）

公式のカード検索ページから、カードID・名前・画像URL・詳細URL などを取得して `cards` に挿入します。この時点では **詳細（HP・ワザなど）は未取得** です。

```bash
npm run db:collect-ids
```

- デフォルトは検索ページの初期表示（現行レギュレーション）を取得
- **1ページ目だけ取得**: `node scripts/collect-card-ids.js --pages=1`  もしくは　`npm run db:collect-ids -- --pages=1`
  （`pages` は公式検索のページネーション単位。1ページ＝画面上の1ページ分＝約39枚）
- 全レギュレーションを巡回する場合: `node scripts/collect-card-ids.js --all`
- 既に存在する `card_id` は更新（上書き）

## 6. 詳細情報の収集（詳細ページから）

`cards` のうち **詳細未取得（`hp` が NULL）** のカードについて、1枚ずつ詳細ページにアクセスして HP・ワザ・弱点・抵抗力などを取得し、`cards` を更新して `waza` / `waza_energy_cost` に保存します。

```bash
# デフォルト: 最大50件まで取得
npm run db:collect-details

# 件数指定（例: 100件）
node scripts/collect-details.js --limit=100
```

- 1カードあたり約1.2秒待機（公式サイトへの負荷軽減）
- 結果は `collection_logs` に記録
- 複数回実行すると、未取得のカードが続きから処理されます

## 7. 運用の流れ（推奨）

1. **初回**
   - `npm run db:init`
   - `npm run db:collect-ids` でカードID・基本情報を一括投入
   - `npm run db:collect-details` を繰り返し実行（または `--limit=500` などでまとめて実行）して詳細を埋める
2. **追加収集**
   - 新レギュレーションや新セット用に再度 `db:collect-ids` を実行したあと、同じく `db:collect-details` で未取得分を取得

## 8. Cloudflare D1 を利用する場合

PostgreSQL の代わりに **Cloudflare D1**（SQLite）を DB として使うことができます。収集スクリプト・init/verify は環境変数 `USE_D1=1` で D1 向けに切り替わります。

### 前提

- **wrangler** をインストール済み（`npm install -D wrangler`）
- **wrangler.toml** に D1 の `[[d1_databases]]` を記載済み（`database_name` と `database_id`）
- 初回のみ `npx wrangler login` で Cloudflare にログイン済み
- D1 データベースを CLI またはダッシュボードで作成済み

### 手順

1. **スキーマ投入（初回）**
   ```bash
   USE_D1=1 node scripts/init-db.js
   ```
   または手動で:
   ```bash
   npx wrangler d1 execute pokeca --remote --file=./database/schema-d1.sql
   ```

2. **接続確認**
   ```bash
   USE_D1=1 node scripts/verify-db.js
   ```

3. **カードID収集**
   ```bash
   USE_D1=1 node scripts/collect-card-ids.js --pages=1
   ```

4. **詳細収集**
   ```bash
   USE_D1=1 node scripts/collect-details.js --limit=10
   ```

環境変数 `D1_DATABASE_NAME` で DB 名を指定できます（既定値は `pokeca`）。wrangler.toml の `database_name` と一致させてください。詳細な実装計画は [docs/D1_wrangler_execute_実装計画.md](docs/D1_wrangler_execute_実装計画.md) を参照してください。

---

## 9. 補足

- **レート制限**: 詳細収集は 1 リクエストあたり約 1.2 秒待機します。大量収集時は `--limit` で区切って実行することを推奨します。
- **エラー**: 404 やネットワークエラーは `collection_logs` に `status='error'` で記録されます。必要に応じて該当 `card_id` を確認してください。
- **スキーマ**: テーブル定義は `database/schema.sql`（PostgreSQL）および `database/schema-d1.sql`（D1）です。PostgreSQL 用に `docs/データベース構築計画.md` の設計を反映しています。

### 9.1 収集が 0 件になる場合（トラブルシューティング）

公式サイトがヘッドレスブラウザを検知し、カード一覧の HTML を返していない可能性があります。

- **対処**: 環境変数でヘッドレスを無効にして再実行してみてください（ウィンドウが開きます）。
  ```bash
  HEADLESS=false npm run db:collect-ids
  ```
- 上記で件数が取れる場合、同一環境では以降も `HEADLESS=false` 付きで実行するか、別データソース（API 等）の利用を検討してください。

### 9.2 スキーマ変更時（既存DB）

`schema.sql` にカラム追加などがあった場合、既にテーブルがある環境では `ALTER TABLE` で反映します。

- **例: waza に damage_modifier を追加**
  ```sql
  ALTER TABLE waza ADD COLUMN IF NOT EXISTS damage_modifier TEXT;
  ```
