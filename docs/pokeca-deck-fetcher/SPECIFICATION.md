# pokeca-deck-fetcher 仕様書

## バージョン情報

- **パッケージ名**: `pokeca-deck-fetcher`
- **バージョン**: 1.0.0
- **Node.js**: >= 16.0.0
- **ライセンス**: MIT

## 概要

`pokeca-deck-fetcher`は、ポケモンカードゲーム公式サイトのデッキコードからデッキ情報を取得するNode.jsライブラリです。Puppeteerを使用して公式サイトから情報をスクレイピングし、構造化されたデータとして返します。

## 依存関係

### 必須依存関係

- `puppeteer`: ^24.15.0
- `puppeteer-core`: ^24.15.0

### オプション依存関係

- `@sparticuz/chromium`: ^133.0.0 (Vercel環境で使用する場合)

## API仕様

### 1. `fetchDeckInfo(deckCode, options?)`

デッキコードからデッキ情報を取得するメイン関数です。

#### シグネチャ

```typescript
function fetchDeckInfo(
  deckCode: string,
  options?: FetchOptions
): Promise<DeckInfo>
```

#### パラメータ

##### `deckCode` (必須)

- **型**: `string`
- **形式**: `XXXXXX-XXXXXX-XXXXXX` (6文字-6文字-6文字、英数字、ハイフン区切り)
- **例**: `"gnLgHg-2ee09u-LiNNQ9"`
- **説明**: ポケモンカード公式サイトで発行されるデッキコード

##### `options` (オプション)

- **型**: `FetchOptions`
- **デフォルト値**: `{}`

**FetchOptions のプロパティ:**

| プロパティ | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `environment` | `'local' \| 'vercel'` | `'local'` | 実行環境 |
| `chromium` | `object` | `undefined` | Vercel用のchromiumモジュール（`environment: 'vercel'`の場合に必須） |
| `browserOptions` | `LaunchOptions` | `undefined` | Puppeteerの起動オプション |
| `timeout` | `number` | `30000` | タイムアウト時間（ミリ秒） |
| `getBrowser` | `() => Promise<Browser>` | `undefined` | カスタムブラウザ取得関数 |

#### 戻り値

- **型**: `Promise<DeckInfo>`
- **説明**: デッキ情報を含むオブジェクト

#### 例外

- `InvalidDeckCodeError`: デッキコードの形式が無効な場合
- `TimeoutError`: タイムアウトが発生した場合
- `NetworkError`: ネットワークエラーが発生した場合
- `Error`: その他の予期しないエラー

#### 使用例

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');

// 基本的な使用
const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9');

// オプション指定
const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9', {
  timeout: 60000,
  browserOptions: {
    headless: true
  }
});
```

---

### 2. `createDeckFetcher(options?)`

設定を保持したデッキ情報取得インスタンスを作成します。

#### シグネチャ

```typescript
function createDeckFetcher(
  options?: FetchOptions
): DeckFetcher
```

#### パラメータ

- `options`: `FetchOptions` (オプション) - `fetchDeckInfo`と同じオプション

#### 戻り値

- **型**: `DeckFetcher`
- **説明**: デッキ情報取得インスタンス

#### 使用例

```javascript
const { createDeckFetcher } = require('pokeca-deck-fetcher');

const fetcher = createDeckFetcher({
  timeout: 30000
});

const deckInfo = await fetcher.fetch('gnLgHg-2ee09u-LiNNQ9');
```

---

### 3. `DeckFetcher` クラス

設定を保持したデッキ情報取得クラスです。

#### コンストラクタ

```typescript
constructor(options?: FetchOptions)
```

#### メソッド

##### `fetch(deckCode: string): Promise<DeckInfo>`

デッキ情報を取得します。

- **パラメータ**: `deckCode` (string) - デッキコード
- **戻り値**: `Promise<DeckInfo>`
- **例外**: `InvalidDeckCodeError`, `TimeoutError`, `NetworkError`, `Error`

---

### 4. `validateDeckCode(deckCode)`

デッキコードの形式を検証します。

#### シグネチャ

```typescript
function validateDeckCode(deckCode: string): boolean
```

#### パラメータ

- `deckCode`: `string` - 検証するデッキコード

#### 戻り値

- **型**: `boolean`
- **説明**: 有効な形式の場合 `true`、無効な場合 `false`

#### 検証ルール

- 形式: `XXXXXX-XXXXXX-XXXXXX`
- 各セグメントは6文字の英数字
- セグメント間はハイフンで区切られる
- 大文字・小文字は区別される

#### 使用例

```javascript
const { validateDeckCode } = require('pokeca-deck-fetcher');

validateDeckCode('gnLgHg-2ee09u-LiNNQ9'); // true
validateDeckCode('invalid'); // false
```

---

## データ構造

### `DeckInfo`

デッキ情報のルートオブジェクトです。

```typescript
interface DeckInfo {
  deckCode: string;        // デッキコード
  totalCards: number;       // 総枚数（通常は60枚）
  cards: Card[];            // カード一覧
  summary: DeckSummary;     // サマリー情報
}
```

#### プロパティ詳細

| プロパティ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `deckCode` | `string` | デッキコード | `"gnLgHg-2ee09u-LiNNQ9"` |
| `totalCards` | `number` | デッキの総枚数 | `60` |
| `cards` | `Card[]` | カード情報の配列 | 下記参照 |
| `summary` | `DeckSummary` | カテゴリ別のサマリー | 下記参照 |

---

### `Card`

個別のカード情報です。

```typescript
interface Card {
  cardId: string;          // カードID（5桁）
  name: string;           // カード名
  fullName: string;        // 正式名称（セット情報含む）
  count: number;          // 枚数
  category: string;       // カテゴリ
  mainFlag: number;       // メインフラグ（1または9）
  imageUrl: string | null; // 画像URL
  detailUrl: string;      // 詳細ページURL
}
```

#### プロパティ詳細

| プロパティ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `cardId` | `string` | 5桁のカードID | `"46326"` |
| `name` | `string` | カードの表示名 | `"ブリジュラスex"` |
| `fullName` | `string` | セット情報を含む正式名称 | `"ブリジュラスex(SV7a 080/064)"` |
| `count` | `number` | デッキ内の枚数 | `3` |
| `category` | `string` | カテゴリ名 | `"ポケモン"`, `"グッズ"`, `"ポケモンのどうぐ"`, `"サポート"`, `"スタジアム"`, `"エネルギー"` |
| `mainFlag` | `number` | メインポケモンフラグ | `1` (通常) または `9` (メイン) |
| `imageUrl` | `string \| null` | カード画像のURL | `"https://www.pokemon-card.com/..."` または `null` |
| `detailUrl` | `string` | カード詳細ページのURL | `"https://www.pokemon-card.com/card-search/details.php/card/46326/"` |

#### カテゴリ一覧

- `"ポケモン"`: ポケモンカード
- `"グッズ"`: グッズカード
- `"ポケモンのどうぐ"`: ポケモンのどうぐカード
- `"サポート"`: サポートカード
- `"スタジアム"`: スタジアムカード
- `"エネルギー"`: エネルギーカード

---

### `DeckSummary`

デッキのサマリー情報です。

```typescript
interface DeckSummary {
  pokemon: number;        // ポケモンの種類数
  goods: number;         // グッズの種類数
  tool: number;          // ポケモンのどうぐの種類数
  support: number;       // サポートの種類数
  stadium: number;       // スタジアムの種類数
  energy: number;        // エネルギーの種類数
  totalCardTypes: number; // 総カード種類数
}
```

#### プロパティ詳細

| プロパティ | 型 | 説明 | 例 |
|-----------|-----|------|-----|
| `pokemon` | `number` | ポケモンカードの種類数 | `6` |
| `goods` | `number` | グッズカードの種類数 | `5` |
| `tool` | `number` | ポケモンのどうぐカードの種類数 | `2` |
| `support` | `number` | サポートカードの種類数 | `5` |
| `stadium` | `number` | スタジアムカードの種類数 | `1` |
| `energy` | `number` | エネルギーカードの種類数 | `2` |
| `totalCardTypes` | `number` | 総カード種類数（重複なし） | `21` |

---

## エラー仕様

### エラークラス階層

```
Error
├── InvalidDeckCodeError
├── TimeoutError
└── NetworkError
```

### `InvalidDeckCodeError`

無効なデッキコードが指定された場合にスローされます。

#### プロパティ

- `name`: `"InvalidDeckCodeError"`
- `message`: エラーメッセージ（例: `"無効なデッキコード形式です。形式: XXXXXX-XXXXXX-XXXXXX"`）

#### 発生条件

- デッキコードが `null` または `undefined` の場合
- デッキコードが文字列でない場合
- デッキコードの形式が `XXXXXX-XXXXXX-XXXXXX` に一致しない場合

#### 使用例

```javascript
const { fetchDeckInfo, InvalidDeckCodeError } = require('pokeca-deck-fetcher');

try {
  await fetchDeckInfo('invalid');
} catch (error) {
  if (error instanceof InvalidDeckCodeError) {
    console.error('無効なデッキコード:', error.message);
  }
}
```

---

### `TimeoutError`

タイムアウトが発生した場合にスローされます。

#### プロパティ

- `name`: `"TimeoutError"`
- `message`: エラーメッセージ（例: `"タイムアウト: ページの読み込みに時間がかかりすぎました"`）

#### 発生条件

- ページの読み込みが `timeout` オプションで指定された時間内に完了しない場合
- Puppeteerの `page.goto()` がタイムアウトした場合

#### 使用例

```javascript
const { fetchDeckInfo, TimeoutError } = require('pokeca-deck-fetcher');

try {
  await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9', { timeout: 1000 });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error('タイムアウト:', error.message);
  }
}
```

---

### `NetworkError`

ネットワークエラーが発生した場合にスローされます。

#### プロパティ

- `name`: `"NetworkError"`
- `message`: エラーメッセージ（例: `"サーバーに接続できませんでした"`）

#### 発生条件

- ネットワーク接続エラー（`net::ERR`, `ECONNREFUSED` など）が発生した場合
- 公式サイトにアクセスできない場合

#### 使用例

```javascript
const { fetchDeckInfo, NetworkError } = require('pokeca-deck-fetcher');

try {
  await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9');
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('ネットワークエラー:', error.message);
  }
}
```

---

## 環境別の動作仕様

### ローカル環境（デフォルト）

- **環境指定**: `environment: 'local'` または未指定
- **使用するPuppeteer**: `puppeteer` (フルバージョン)
- **ブラウザ起動**: システムにインストールされたChrome/Chromiumを使用
- **デフォルトオプション**:
  ```javascript
  {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  }
  ```

### Vercel環境

- **環境指定**: `environment: 'vercel'`
- **必須**: `chromium` オプションに `@sparticuz/chromium` モジュールを指定
- **使用するPuppeteer**: `puppeteer-core`
- **ブラウザ起動**: Vercel提供のChromiumバイナリを使用
- **デフォルトオプション**: VercelのChromium設定を使用

#### 使用例

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');
const chromium = require('@sparticuz/chromium');

const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9', {
  environment: 'vercel',
  chromium: chromium,
  timeout: 25000
});
```

---

## パフォーマンス仕様

### タイムアウト

- **デフォルト**: 30秒（30000ミリ秒）
- **推奨値**:
  - ローカル環境: 30秒
  - Vercel環境: 25秒（Vercelの制限を考慮）

### リソース要件

- **メモリ**: 最低512MB、推奨1GB以上
- **CPU**: 1コア以上
- **ディスク**: PuppeteerのChromiumバイナリ用に約300MB

### 処理時間

- **平均**: 5-15秒（ネットワーク状況による）
- **最大**: タイムアウト時間まで

---

## 制約事項

### デッキコードの制約

1. **形式**: `XXXXXX-XXXXXX-XXXXXX` の形式のみ有効
2. **有効性**: 公式サイトで発行されたデッキコードのみ有効
3. **永続性**: 公式サイトのデータベースに保存されている期間のみ有効

### 取得可能な情報の制約

1. **たねポケモン情報**: デッキコードから直接取得できない
   - カード詳細ページから別途取得が必要
2. **カード詳細情報**: 基本的な情報のみ取得可能
   - HP、ワザ、弱点などの詳細情報は含まれない

### サーバー負荷の考慮

1. **リクエスト間隔**: 1秒以上の間隔を推奨
2. **同時リクエスト**: 複数のリクエストを同時に実行しないことを推奨
3. **キャッシュ**: 同じデッキコードはキャッシュすることを推奨

---

## セキュリティ仕様

### 入力検証

- デッキコードの形式を厳密に検証
- 不正な入力に対して適切なエラーを返却

### エラーメッセージ

- 機密情報を含むエラーメッセージは100文字に制限
- スタックトレースはコンソールにのみ出力

### 外部リソース

- 公式サイト（https://www.pokemon-card.com/）のみにアクセス
- User-Agentを適切に設定（Bot検知回避）

---

## 互換性

### Node.jsバージョン

- **最小**: Node.js 16.0.0
- **推奨**: Node.js 18.0.0 以上

### プラットフォーム

- **対応OS**: Windows, macOS, Linux
- **アーキテクチャ**: x64, ARM64

### 実行環境

- **ローカル環境**: 完全対応
- **Vercel**: 完全対応
- **その他のServerless環境**: カスタム設定で対応可能

---

## 変更履歴

### 1.0.0 (2024-01-XX)

- 初回リリース
- デッキコードからデッキ情報を取得する基本機能
- ローカル環境とVercel環境のサポート
- TypeScript型定義の提供

---

## 参考資料

- [README.md](./README.md) - 基本的な使用方法
- [QUICKSTART.md](./QUICKSTART.md) - クイックスタートガイド
- [USAGE.md](./USAGE.md) - 詳細な使用手順
- [INTEGRATION.md](./INTEGRATION.md) - 別アプリへの統合方法
- [TESTING.md](./TESTING.md) - テスト手順

---

## 免責事項

このライブラリは非公式のツールです。公式サイトの利用規約を遵守してご利用ください。公式サイトの仕様変更により、本ライブラリが動作しなくなる可能性があります。
