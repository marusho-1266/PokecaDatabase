/**
 * カード検索APIルート
 */

import express from 'express';
import { searchCards } from '../services/scraper.js';
import { getCardDetail } from '../services/cardDetail.js';
import { InvalidParameterError, NotFoundError } from '../utils/errors.js';

const router = express.Router();

/**
 * GET /api/cards/search
 * カード検索を実行
 */
router.get('/search', async (req, res) => {
  try {
    const { name, cardId, category } = req.query;
    
    // パラメータのバリデーション
    if (!name && !cardId && !category) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: '検索条件を少なくとも1つ指定してください'
        }
      });
    }
    
    if (cardId && !/^\d{5}$/.test(cardId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'カードIDは5桁の数値である必要があります'
        }
      });
    }
    
    // 検索を実行
    const cards = await searchCards({
      name,
      cardId,
      category
    });
    
    // ページネーション（Phase 1では簡易実装）
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedCards = cards.slice(start, end);
    
    res.json({
      success: true,
      data: {
        cards: paginatedCards,
        pagination: {
          page,
          limit,
          total: cards.length,
          totalPages: Math.ceil(cards.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('検索エラー:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: error.name || 'SERVER_ERROR',
        message: error.message || 'サーバーエラーが発生しました'
      }
    });
  }
});

/**
 * GET /api/cards/:cardId
 * カードIDから詳細情報を取得
 */
router.get('/:cardId', async (req, res) => {
  try {
    const { cardId } = req.params;
    const { regulation } = req.query;
    
    // パラメータのバリデーション
    if (!/^\d{5}$/.test(cardId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETER',
          message: 'カードIDは5桁の数値である必要があります'
        }
      });
    }
    
    // カード詳細を取得
    const cardDetail = await getCardDetail(cardId, regulation);
    
    res.json({
      success: true,
      data: cardDetail
    });
  } catch (error) {
    console.error('カード詳細取得エラー:', error);
    
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message
        }
      });
    }
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      error: {
        code: error.name || 'SERVER_ERROR',
        message: error.message || 'サーバーエラーが発生しました'
      }
    });
  }
});

export default router;
