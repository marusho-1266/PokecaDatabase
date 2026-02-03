/**
 * Expressサーバー
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cardsRouter from './routes/cards.js';
import { closeBrowser } from './utils/browser.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ログミドルウェア
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ルート
app.get('/', (req, res) => {
  res.json({
    message: 'ポケモンカード検索API',
    version: '1.0.0',
    endpoints: {
      search: 'GET /api/cards/search?name=カード名&cardId=カードID&category=カテゴリ',
      detail: 'GET /api/cards/:cardId?regulation=レギュレーション'
    }
  });
});

// APIルート
app.use('/api/cards', cardsRouter);

// エラーハンドリングミドルウェア
app.use((err, req, res, next) => {
  console.error('エラー:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.name || 'SERVER_ERROR',
      message: err.message || 'サーバーエラーが発生しました'
    }
  });
});

// 404ハンドラー
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'エンドポイントが見つかりませんでした'
    }
  });
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});

// 終了時の処理
process.on('SIGINT', async () => {
  console.log('サーバーを終了します...');
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('サーバーを終了します...');
  await closeBrowser();
  process.exit(0);
});
