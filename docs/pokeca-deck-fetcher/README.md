# pokeca-deck-fetcher

ポケモンカードゲームのデッキコードからデッキ情報を取得するNode.jsライブラリです。

## インストール

```bash
npm install pokeca-deck-fetcher
```

### 依存関係

- `puppeteer`: ブラウザ自動化（ローカル環境用）
- `puppeteer-core`: ブラウザ自動化（Vercel等のServerless環境用）
- `@sparticuz/chromium`: Vercel環境で使用する場合（オプション）

## 基本的な使用方法

### シンプルな例

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');

async function main() {
  try {
    const deckCode = 'gnLgHg-2ee09u-LiNNQ9';
    const deckInfo = await fetchDeckInfo(deckCode);
    
    console.log('デッキコード:', deckInfo.deckCode);
    console.log('総枚数:', deckInfo.totalCards);
    console.log('カード一覧:', deckInfo.cards);
  } catch (error) {
    console.error('エラー:', error.message);
  }
}

main();
```

### ES Modulesを使用する場合

```javascript
import { fetchDeckInfo } from 'pokeca-deck-fetcher';

const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9');
console.log(deckInfo);
```

## 環境に応じた設定

### ローカル環境（デフォルト）

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');

// デフォルト設定で使用（自動的にpuppeteerを使用）
const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9');
```

### Vercel/Serverless環境

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');
const chromium = require('@sparticuz/chromium');

// Vercel環境用の設定
const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9', {
  environment: 'vercel',
  chromium: chromium
});
```

### カスタムPuppeteer設定

```javascript
const { fetchDeckInfo } = require('pokeca-deck-fetcher');

const deckInfo = await fetchDeckInfo('gnLgHg-2ee09u-LiNNQ9', {
  browserOptions: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  },
  timeout: 30000
});
```

### 再利用可能なインスタンス

```javascript
const { createDeckFetcher } = require('pokeca-deck-fetcher');

// 設定を保持したインスタンスを作成
const fetcher = createDeckFetcher({
  environment: 'local',
  timeout: 25000
});

// 複数回使用可能
const deckInfo1 = await fetcher.fetch('gnLgHg-2ee09u-LiNNQ9');
const deckInfo2 = await fetcher.fetch('8Ycc8D-KkhEeK-xcJcKY');
```

## API

### `fetchDeckInfo(deckCode, options?)`

デッキコードからデッキ情報を取得します。

**パラメータ:**
- `deckCode` (string): デッキコード（形式: `XXXXXX-XXXXXX-XXXXXX`）
- `options` (object, オプション): 設定オプション
  - `environment` (string): 環境 (`'local'` | `'vercel'`). デフォルト: `'local'`
  - `chromium` (object): Vercel用のchromiumモジュール（`environment: 'vercel'`の場合に必要）
  - `browserOptions` (object): Puppeteerの起動オプション
  - `timeout` (number): タイムアウト時間（ミリ秒）. デフォルト: `30000`
  - `getBrowser` (function): カスタムブラウザ取得関数

**戻り値:**
- `Promise<DeckInfo>`: デッキ情報オブジェクト

**DeckInfo の構造:**
```typescript
{
  deckCode: string;        // デッキコード
  totalCards: number;       // 総枚数
  cards: Card[];            // カード一覧
  summary: {               // サマリー
    pokemon: number;        // ポケモンの種類数
    goods: number;         // グッズの種類数
    tool: number;          // ポケモンのどうぐの種類数
    support: number;       // サポートの種類数
    stadium: number;       // スタジアムの種類数
    energy: number;        // エネルギーの種類数
    totalCardTypes: number; // 総カード種類数
  }
}
```

**Card の構造:**
```typescript
{
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

### `createDeckFetcher(options?)`

設定を保持したデッキ情報取得インスタンスを作成します。

**パラメータ:**
- `options` (object, オプション): 設定オプション（`fetchDeckInfo`と同じ）

**戻り値:**
- `DeckFetcher`: デッキ情報取得インスタンス

**メソッド:**
- `fetch(deckCode)`: デッキ情報を取得

### `validateDeckCode(deckCode)`

デッキコードの形式を検証します。

**パラメータ:**
- `deckCode` (string): デッキコード

**戻り値:**
- `boolean`: 有効な形式かどうか

## エラーハンドリング

```javascript
const { fetchDeckInfo, InvalidDeckCodeError, TimeoutError, NetworkError } = require('pokeca-deck-fetcher');

try {
  const deckInfo = await fetchDeckInfo('invalid-code');
} catch (error) {
  if (error instanceof InvalidDeckCodeError) {
    console.error('無効なデッキコード:', error.message);
  } else if (error instanceof TimeoutError) {
    console.error('タイムアウト:', error.message);
  } else if (error instanceof NetworkError) {
    console.error('ネットワークエラー:', error.message);
  } else {
    console.error('予期しないエラー:', error);
  }
}
```

## 使用例

### Express APIとして使用

```javascript
const express = require('express');
const { fetchDeckInfo } = require('pokeca-deck-fetcher');

const app = express();
app.use(express.json());

app.post('/api/deck', async (req, res) => {
  try {
    const { deckCode } = req.body;
    
    if (!deckCode) {
      return res.status(400).json({ error: 'デッキコードが指定されていません' });
    }

    const deckInfo = await fetchDeckInfo(deckCode);
    res.json({ success: true, data: deckInfo });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(3000);
```

### バッチ処理

```javascript
const { createDeckFetcher } = require('pokeca-deck-fetcher');

const fetcher = createDeckFetcher();
const deckCodes = ['gnLgHg-2ee09u-LiNNQ9', '8Ycc8D-KkhEeK-xcJcKY'];

// 順次処理
for (const deckCode of deckCodes) {
  try {
    const deckInfo = await fetcher.fetch(deckCode);
    console.log(`${deckCode}: ${deckInfo.totalCards}枚`);
  } catch (error) {
    console.error(`${deckCode}: エラー - ${error.message}`);
  }
}
```

## ドキュメント

- [仕様書](./SPECIFICATION.md) - 詳細なAPI仕様とデータ構造
- [クイックスタート](./QUICKSTART.md) - 5分で始める
- [使用手順ガイド](./USAGE.md) - 詳細な使用方法
- [統合方法](./INTEGRATION.md) - 別アプリへの統合方法
- [公開手順](./PUBLISH.md) - npmへの公開方法
- [テスト手順](./TESTING.md) - ローカルでのテスト方法
- [パッケージ構造](./STRUCTURE.md) - ファイル構成
- [実装サマリー](./SUMMARY.md) - 実装完了内容のまとめ

## 注意事項

- このライブラリは公式サイト（https://www.pokemon-card.com/）から情報を取得しています
- サーバーへの負荷を考慮し、適切な間隔でリクエストしてください
- デッキコードは16桁（ハイフン含む）の形式です
- Puppeteerを使用するため、十分なメモリとCPUリソースが必要です

## ライセンス

MIT License

## 免責事項

このライブラリは非公式のツールです。公式サイトの利用規約を遵守してご利用ください。
