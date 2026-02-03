/**
 * 公式サイトからのカード検索スクレイピング
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPage } from '../utils/browser.js';
import { TimeoutError, NetworkError } from '../utils/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL = 'https://www.pokemon-card.com/card-search/';
const SEARCH_INDEX_URL = 'https://www.pokemon-card.com/card-search/index.php';
const REQUEST_DELAY = 1000; // 1秒

// #region agent log
const LOG_PATH = path.join(__dirname, '../../debug-collect.log');
const DEBUG_LOG = (payload) => {
  const line = JSON.stringify({ ...payload, timestamp: Date.now(), sessionId: 'debug-session' }) + '\n';
  try { fs.appendFileSync(LOG_PATH, line); } catch (_) {}
  fetch('http://127.0.0.1:7243/ingest/de0d88b5-99da-4f7e-ab74-e28376d0afce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: line }).catch(() => {});
};
// #endregion

/** データベース収集用: 検索結果を取得（基本情報のみ）。regulation なし＝初期表示のスタンダード */
export async function fetchSearchResultPage(regulation, pageNumber = 1) {
  const page = await createPage();
  const requestUrls = [];
  try {
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('pokemon-card.com')) {
        requestUrls.push({ url: u.slice(0, 150), resourceType: req.resourceType() });
      }
    });
    const params = new URLSearchParams({ keyword: '', se_ta: '', illust: '', sm_and_keyword: 'true' });
    if (regulation) {
      params.set('regulation_sidebar_form', regulation);
    }
    params.set('pg', pageNumber === 1 ? '' : String(pageNumber));
    const url = `${SEARCH_INDEX_URL}?${params.toString()}`;
    // #region agent log
    DEBUG_LOG({ location: 'scraper.js:fetchSearchResultPage', message: 'URL to open', data: { url, regulation, pageNumber }, hypothesisId: 'A' });
    // #endregion
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 4000));
    // #region agent log
    const pageStateAfterGoto = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a[href]')).map(a => (a.getAttribute('href') || '').slice(0, 80));
      const forms = Array.from(document.querySelectorAll('form')).map((f, i) => ({ i, action: (f.action || '').slice(0, 80), id: f.id || null }));
      return {
        formCount: document.querySelectorAll('form').length,
        submitCount: document.querySelectorAll('input[type="submit"], button[type="submit"]').length,
        bodyPreview: document.body ? document.body.innerText.slice(0, 250) : '',
        allHrefsSample: allLinks.slice(0, 25),
        formsInfo: forms
      };
    });
    DEBUG_LOG({ location: 'scraper.js:afterGoto', message: 'Page state after goto', data: { url: page.url(), title: await page.title(), ...pageStateAfterGoto }, hypothesisId: 'A,D,G,H' });
    // #endregion
    // パラメータ付きで開いた場合、既に結果が表示されている可能性がある。先に短時間だけ待つ
    const hasResultWithoutClick = await page.waitForFunction(
      () => {
        if (window.PCGDECK && window.PCGDECK.searchItemName && Object.keys(window.PCGDECK.searchItemName).length > 0) return true;
        return document.querySelectorAll('a[href*="/card/"]').length > 0;
      },
      { timeout: 8000 }
    ).then(() => true).catch(() => false);
    if (hasResultWithoutClick) {
      DEBUG_LOG({ location: 'scraper.js:noClick', message: 'Result already present without form submit', data: { url: page.url() }, hypothesisId: 'direct' });
    }
    // 一覧は「検索」実行後に描画される。フォーム送信で遷移する場合とAJAXで更新する場合の両方に対応
    const searchClicked = hasResultWithoutClick ? { ok: false } : await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form'));
      const cardForm = forms.find(f => (f.action || '').includes('card-search') || (f.action || '').includes('index.php'));
      if (cardForm) {
        const submit = cardForm.querySelector('input[type="submit"], button[type="submit"]');
        if (submit) {
          submit.click();
          return { ok: true, source: 'cardFormSubmit' };
        }
        cardForm.submit();
        return { ok: true, source: 'cardFormSubmitDirect' };
      }
      const submit = document.querySelector('input[type="submit"], button[type="submit"]');
      if (submit) {
        submit.click();
        return { ok: true, source: 'firstSubmit' };
      }
      return { ok: false };
    });
    if (searchClicked && searchClicked.ok) {
      // 結果表示（PCGDECK またはカードリンク）が出現するまで待つ
      await page.waitForFunction(
        () => {
          if (window.PCGDECK && window.PCGDECK.searchItemName && Object.keys(window.PCGDECK.searchItemName).length > 0) return true;
          return document.querySelectorAll('a[href*="/card/"]').length > 0;
        },
        { timeout: 35000 }
      ).catch(() => null);
      // #region agent log
      const urlAfterWait = page.url();
      const quickCheck = await page.evaluate(() => ({
        linkCount: document.querySelectorAll('a[href*="/card/"]').length,
        pcgd: window.PCGDECK && window.PCGDECK.searchItemName ? Object.keys(window.PCGDECK.searchItemName).length : 0
      }));
      DEBUG_LOG({ location: 'scraper.js:afterRace', message: 'After wait for result', data: { urlAfterWait, ...quickCheck }, hypothesisId: 'B' });
      // #endregion
      // まだ0件ならスクロールで遅延読み込みをトリガー（最大3回）
      if (quickCheck.linkCount === 0 && quickCheck.pcgd === 0) {
        for (let scrollRound = 0; scrollRound < 3; scrollRound++) {
          await page.evaluate(() => {
            const main = document.querySelector('main, .main, #main, .content, .search-result, [class*="result"]') || document.body;
            main.scrollTop = main.scrollHeight;
          });
          await new Promise((r) => setTimeout(r, 1500));
          const afterScroll = await page.evaluate(() => ({
            linkCount: document.querySelectorAll('a[href*="/card/"]').length,
            pcgd: window.PCGDECK && window.PCGDECK.searchItemName ? Object.keys(window.PCGDECK.searchItemName).length : 0
          }));
          DEBUG_LOG({ location: 'scraper.js:afterScroll', message: 'After scroll round', data: { scrollRound: scrollRound + 1, ...afterScroll }, hypothesisId: 'lazy' });
          if (afterScroll.linkCount > 0 || afterScroll.pcgd > 0) break;
        }
      }
      // 1ページあたり約39枚表示のため、ウィンドウを段階スクロールして遅延読み込みをトリガー
      const scrollTarget = await page.evaluate(() => ({
        scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        clientHeight: window.innerHeight
      })).catch(() => ({ scrollHeight: 4000, clientHeight: 720 }));
      const stepPx = 300;
      let scrollTop = 0;
      while (scrollTop < scrollTarget.scrollHeight) {
        await page.evaluate((y) => { window.scrollTo(0, y); }, scrollTop);
        scrollTop += stepPx;
        await new Promise((r) => setTimeout(r, 900));
      }
      await page.evaluate(() => { window.scrollTo(0, 0); });
      await new Promise((r) => setTimeout(r, 800));
      // カード画像が十分出るまで待つ（最大12秒、目標39枚のうち35枚以上）
      await page.waitForFunction(
        () => {
          const imgs = document.querySelectorAll('img[src*="card_images"], img[data-src*="card_images"]');
          return imgs.length >= 35;
        },
        { timeout: 12000 }
      ).catch(() => null);
      const imgCountAfterScroll = await page.evaluate(() =>
        document.querySelectorAll('img[src*="card_images"], img[data-src*="card_images"]').length
      ).catch(() => 0);
      DEBUG_LOG({ location: 'scraper.js:afterStepScroll', message: 'Card img count after step scroll', data: { imgCountAfterScroll }, hypothesisId: 'lazy' });
      await new Promise((r) => setTimeout(r, 2000));
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      await new Promise((r) => setTimeout(r, 2000));
    }
    // #region agent log
    DEBUG_LOG({ location: 'scraper.js:afterClick', message: 'Search button + nav wait', data: { searchClicked, finalUrl: page.url() }, hypothesisId: 'fix' });
    // #endregion
    const debugState = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/card/"]'));
      const withMatch = links.filter(a => (a.href || '').match(/\/card\/(\d{5})\//));
      const shadowLinks = [];
      const walk = (root) => {
        try {
          if (root.querySelectorAll) {
            root.querySelectorAll('a[href*="/card/"]').forEach((a) => {
              const href = (a.href || a.getAttribute('href') || '');
              if (/\/card\/(\d{5})\//.test(href)) shadowLinks.push(href.slice(0, 60));
            });
            root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
          }
        } catch (_) {}
      };
      walk(document);
      return {
        hasPCGDECK: !!(window.PCGDECK),
        searchItemNameKeys: window.PCGDECK && window.PCGDECK.searchItemName ? Object.keys(window.PCGDECK.searchItemName).length : 0,
        linkCount: links.length,
        linkWith5digitCount: withMatch.length,
        shadowRootLinkCount: shadowLinks.length,
        shadowRootLinkSample: shadowLinks.slice(0, 3),
        sampleHrefs: links.slice(0, 5).map(a => a.href || a.getAttribute('href')),
        bodySnippet: document.body ? document.body.innerText.slice(0, 300) : '',
        iframeCount: document.querySelectorAll('iframe').length
      };
    });
    // #region agent log
    DEBUG_LOG({ location: 'scraper.js:afterWait', message: 'Page state after 3s', data: debugState, hypothesisId: 'B,C,D,shadow' });
    const frames = page.frames();
    const frameStates = await Promise.all(frames.map(async (f, i) => {
      try {
        const st = await f.evaluate(() => ({
          linkCount: document.querySelectorAll('a[href*="/card/"]').length,
          hasPCGDECK: !!(window.PCGDECK && window.PCGDECK.searchItemName),
          sampleHref: document.querySelector('a[href*="/card/"]') ? (document.querySelector('a[href*="/card/"]').href || '').slice(0, 60) : null
        }));
        return { frameIndex: i, url: f.url(), ...st };
      } catch (e) {
        return { frameIndex: i, url: f.url(), error: e.message };
      }
    }));
    DEBUG_LOG({ location: 'scraper.js:frameCheck', message: 'Each frame linkCount', data: { frameStates }, hypothesisId: 'iframe' });
    // #endregion
    const hasData = await page.waitForFunction(
      () => {
        if (window.PCGDECK && window.PCGDECK.searchItemName && Object.keys(window.PCGDECK.searchItemName).length > 0) return true;
        return document.querySelectorAll('a[href*="/card/"]').length > 0;
      },
      { timeout: 20000 }
    ).catch(() => null);
    // #region agent log
    DEBUG_LOG({ location: 'scraper.js:waitForFunction', message: 'PCGDECK populated?', data: { hasData: hasData !== null }, hypothesisId: 'C,E' });
    // #endregion
    if (!hasData) {
      await new Promise((r) => setTimeout(r, 5000));
    }
    let cards = await extractCardsFromPage(page);
    // #region agent log
    DEBUG_LOG({ location: 'scraper.js:firstExtract', message: 'First extract result', data: { cardsLength: cards.length }, hypothesisId: 'all' });
    // #endregion
    if (cards.length === 0) {
      await new Promise((r) => setTimeout(r, 5000));
      cards = await extractCardsFromPage(page);
      const debugAfterRetry = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/card/"]'));
        return { linkCount: links.length, sampleHrefs: links.slice(0, 8).map(a => (a.href || a.getAttribute('href') || '').slice(0, 80)) };
      });
      // #region agent log
      DEBUG_LOG({ location: 'scraper.js:afterRetry', message: 'After retry still 0', data: { cardsLength: cards.length, debugAfterRetry, requestUrls: requestUrls.slice(-15) }, hypothesisId: 'B,D,network' });
      // 0件時: HTML構造調査（カード一覧が別形式で埋め込まれていないか）
      const htmlProbe = await page.evaluate(() => {
        const bodyHtml = document.body ? document.body.innerHTML.length : 0;
        const scripts = Array.from(document.querySelectorAll('script')).map(s => ({ src: (s.src || '').slice(0, 80), inlineLength: (s.textContent || '').length }));
        const hasCardInHtml = document.body && /\/card\/\d{5}\//.test(document.body.innerHTML);
        const cardMatchInHtml = document.body ? document.body.innerHTML.match(/\/card\/(\d{5})\//g) : null;
        return { bodyHtmlLength: bodyHtml, hasCardInHtml: !!hasCardInHtml, cardMatchCount: cardMatchInHtml ? cardMatchInHtml.length : 0, scriptsSample: scripts.slice(0, 8) };
      });
      DEBUG_LOG({ location: 'scraper.js:htmlProbe', message: 'HTML probe when 0 cards', data: htmlProbe, hypothesisId: 'embed' });
      // #endregion
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY));
    return cards;
  } finally {
    await page.close();
  }
}

/**
 * 検索条件を構築
 * @param {Object} params - 検索パラメータ
 * @returns {Object} 検索条件オブジェクト
 */
function buildSearchParams(params) {
  const searchParams = {};
  
  if (params.name) {
    searchParams.card_name = params.name;
  }
  
  if (params.cardId) {
    searchParams.card_id = params.cardId;
  }
  
  if (params.category) {
    // カテゴリのマッピング
    const categoryMap = {
      'ポケモン': 'pokemon',
      'グッズ': 'goods',
      'ポケモンのどうぐ': 'tool',
      'サポート': 'support',
      'スタジアム': 'stadium',
      'エネルギー': 'energy'
    };
    searchParams.card_type = categoryMap[params.category] || params.category;
  }
  
  return searchParams;
}

/**
 * 検索結果ページからカード情報を抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Card[]>}
 */
async function extractCardsFromPage(page) {
  return await page.evaluate(() => {
    const cards = [];
    const cardLinksFromDOM = (() => {
      const links = [];
      const walk = (root) => {
        try {
          if (root.querySelectorAll) {
            root.querySelectorAll('a[href*="/card/"]').forEach((a) => {
              const href = a.href || a.getAttribute('href') || '';
              const m = href.match(/\/card\/(\d{5})\//);
              if (m && !links.some((l) => l.cardId === m[1])) links.push({ cardId: m[1], href, text: (a.textContent || '').trim().slice(0, 100) });
            });
            root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
          }
        } catch (_) {}
      };
      walk(document);
      return links;
    })();

    // PCGDECKオブジェクトからカード情報を取得（デッキページと同様の仕組み）
    if (window.PCGDECK && window.PCGDECK.searchItemName) {
      const cardIds = Object.keys(window.PCGDECK.searchItemName);
      
      cardIds.forEach((cardId) => {
        try {
          const name = window.PCGDECK.searchItemNameAlt && window.PCGDECK.searchItemNameAlt[cardId]
            ? window.PCGDECK.searchItemNameAlt[cardId]
            : '';
          const fullName = window.PCGDECK.searchItemName[cardId] || name;
          
          // 画像URLの取得
          let imageUrl = null;
          if (window.PCGDECK.searchItemCardPict && window.PCGDECK.searchItemCardPict[cardId]) {
            const relativePath = window.PCGDECK.searchItemCardPict[cardId];
            imageUrl = 'https://www.pokemon-card.com' + relativePath;
          }
          
          // 詳細ページURL
          const detailUrl = `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`;
          
          // カテゴリの判定（PCGDECKから取得できない場合は、ページ上の要素から取得を試みる）
          let category = '不明';
          const cardElement = document.querySelector(`[data-card-id="${cardId}"], a[href*="/card/${cardId}/"]`);
          if (cardElement) {
            const categoryElement = cardElement.closest('.card-item, .search-result-item, .result-item');
            if (categoryElement) {
              const categoryText = categoryElement.querySelector('.category, .card-type, .card-category');
              if (categoryText) {
                category = categoryText.textContent.trim();
              }
            }
          }
          
          cards.push({
            cardId,
            name: name || fullName.split('(')[0].trim(),
            fullName: fullName || name,
            category: category,
            imageUrl: imageUrl,
            detailUrl
          });
        } catch (error) {
          console.error('カード情報の抽出エラー:', error);
        }
      });
    } else {
      // PCGDECKが使えない場合のフォールバック: HTML要素から抽出
      const cardElements = document.querySelectorAll(
        '.card-item, .search-result-item, [data-card-id], .result-item, .card-list-item, tr[data-card-id]'
      );
      
      cardElements.forEach((element) => {
        try {
          // カードIDの取得
          let cardId = element.getAttribute('data-card-id');
          if (!cardId) {
            const link = element.querySelector('a[href*="/card/"]');
            if (link) {
              const hrefMatch = link.href.match(/\/card\/(\d{5})\//);
              if (hrefMatch) {
                cardId = hrefMatch[1];
              }
            }
          }
          
          if (!cardId) return;
          
          // カード名の取得
          const nameElement = element.querySelector('.card-name, .name, h3, h4, .card-title, td');
          const name = nameElement ? nameElement.textContent.trim() : '';
          
          // 正式名称（セット情報含む）
          const fullNameElement = element.querySelector('.full-name, .card-full-name, .card-name-full');
          const fullName = fullNameElement ? fullNameElement.textContent.trim() : name;
          
          // カテゴリの取得
          const categoryElement = element.querySelector('.category, .card-type, .card-category');
          const category = categoryElement ? categoryElement.textContent.trim() : '不明';
          
          // 画像URLの取得
          const imgElement = element.querySelector('img');
          let imageUrl = null;
          if (imgElement) {
            imageUrl = imgElement.src || imgElement.getAttribute('data-src');
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = 'https://www.pokemon-card.com' + imageUrl;
            }
          }
          
          // PCGDECKから画像URLを取得（優先）
          if (window.PCGDECK && window.PCGDECK.searchItemCardPict && window.PCGDECK.searchItemCardPict[cardId]) {
            const relativePath = window.PCGDECK.searchItemCardPict[cardId];
            imageUrl = 'https://www.pokemon-card.com' + relativePath;
          }
          
          // 詳細ページURL
          const detailLink = element.querySelector('a[href*="/card/"]');
          let detailUrl = '';
          if (detailLink) {
            detailUrl = detailLink.href;
          } else {
            detailUrl = `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`;
          }
          
          cards.push({
            cardId,
            name: name || fullName.split('(')[0].trim(),
            fullName: fullName || name,
            category: category,
            imageUrl: imageUrl,
            detailUrl
          });
        } catch (error) {
          console.error('カード情報の抽出エラー:', error);
        }
      });
    }
    
    // まだ0件ならリンクからカードIDのみ抽出（通常DOM + シャドウDOM）
    if (cards.length === 0 && cardLinksFromDOM.length > 0) {
      cardLinksFromDOM.forEach(({ cardId, href, text }) => {
        cards.push({
          cardId,
          name: text || cardId,
          fullName: text || cardId,
          category: '不明',
          imageUrl: null,
          detailUrl: href.startsWith('http') ? href : `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`
        });
      });
    }
    if (cards.length === 0) {
      const seen = new Set();
      const links = document.querySelectorAll('a[href*="/card/"]');
      links.forEach((link) => {
        const href = link.href || link.getAttribute('href') || '';
        const match = href.match(/\/card\/(\d{5})\//);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          const cardId = match[1];
          cards.push({
            cardId,
            name: (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100) || cardId,
            fullName: (link.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200) || cardId,
            category: '不明',
            imageUrl: null,
            detailUrl: `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`
          });
        }
      });
    }
    // まだ0件なら画像URLからカードIDを抽出（一覧が img のみで描画されている場合。src / data-src 両方対応）
    if (cards.length === 0) {
      const seen = new Set();
      document.querySelectorAll('img[src*="card_images"], img[data-src*="card_images"], img[src*="pokemon-card.com"]').forEach((img) => {
        const src = img.src || img.getAttribute('src') || img.getAttribute('data-src') || '';
        const m = src.match(/[/_](\d{5,6})_P_/);
        if (m) {
          const raw = m[1];
          const cardId = raw.length >= 5 ? raw.replace(/^0+/, '') || raw : raw;
          if (cardId.length >= 4 && !seen.has(cardId)) {
            seen.add(cardId);
            const imageUrl = src.startsWith('http') ? src : 'https://www.pokemon-card.com' + (src.startsWith('/') ? src : '/' + src);
            cards.push({
              cardId,
              name: (img.alt || '').trim().slice(0, 100) || cardId,
              fullName: (img.alt || '').trim().slice(0, 200) || cardId,
              category: '不明',
              imageUrl,
              detailUrl: `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`
            });
          }
        }
      });
    }

    return cards;
  });
}

/**
 * カード検索を実行
 * @param {Object} params - 検索パラメータ
 * @returns {Promise<Card[]>}
 */
export async function searchCards(params) {
  const page = await createPage();
  
  try {
    console.log('検索開始:', params);
    console.log('アクセスURL:', SEARCH_URL);
    
    // 検索ページにアクセス
    await page.goto(SEARCH_URL, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // 現在のURLを確認
    const currentUrl = page.url();
    console.log('現在のURL:', currentUrl);
    console.log('ページタイトル:', await page.title());
    
    // ページの読み込みを待つ
    await page.waitForSelector('body', { timeout: 10000 });
    
    // JavaScriptの実行を待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // ページの構造を確認（デバッグ用）
    const pageInfo = await page.evaluate(() => {
      return {
        hasForm: !!document.querySelector('form'),
        formAction: document.querySelector('form')?.action || null,
        formMethod: document.querySelector('form')?.method || null,
        hasPCGDECK: !!window.PCGDECK,
        searchInputs: Array.from(document.querySelectorAll('input[type="text"], input[name*="name"], input[name*="card"]')).map(el => ({
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          type: el.type
        })),
        searchButtons: Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], button')).map(el => ({
          type: el.type,
          text: el.textContent.trim(),
          className: el.className
        }))
      };
    });
    console.log('ページ情報:', JSON.stringify(pageInfo, null, 2));
    
    // 検索フォームの要素を探す（複数のパターンを試す）
    let nameInput = null;
    let cardIdInput = null;
    let categorySelect = null;
    let searchButton = null;
    
    // カード名入力欄を探す
    const nameSelectors = [
      'input[name="card_name"]',
      'input[name="name"]',
      'input[placeholder*="カード名"]',
      'input[type="text"]',
      '#card_name',
      '#name'
    ];
    
    for (const selector of nameSelectors) {
      nameInput = await page.$(selector);
      if (nameInput) {
        console.log('カード名入力欄を見つけました:', selector);
        break;
      }
    }
    
    // カードID入力欄を探す
    const idSelectors = [
      'input[name="card_id"]',
      'input[name="cardId"]',
      'input[placeholder*="カードID"]',
      '#card_id',
      '#cardId'
    ];
    
    for (const selector of idSelectors) {
      cardIdInput = await page.$(selector);
      if (cardIdInput) {
        console.log('カードID入力欄を見つけました:', selector);
        break;
      }
    }
    
    // カテゴリ選択を探す
    const categorySelectors = [
      'select[name="card_type"]',
      'select[name="category"]',
      'select[name="type"]',
      '#card_type',
      '#category'
    ];
    
    for (const selector of categorySelectors) {
      categorySelect = await page.$(selector);
      if (categorySelect) {
        console.log('カテゴリ選択を見つけました:', selector);
        break;
      }
    }
    
    // 検索フォームに入力
    if (params.name && nameInput) {
      try {
        // まず要素をスクロールして表示領域に持ってくる
        await nameInput.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 既存の値をクリアしてから入力
        await nameInput.evaluate(el => el.value = '');
        await nameInput.type(params.name, { delay: 50 });
        console.log('カード名を入力:', params.name);
      } catch (error) {
        // クリックできない場合は、JavaScriptで直接値を設定
        console.log('クリックできないため、JavaScriptで値を設定');
        await nameInput.evaluate((el, value) => {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, params.name);
        console.log('カード名を入力（JavaScript経由）:', params.name);
      }
    }
    
    if (params.cardId && cardIdInput) {
      try {
        await cardIdInput.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await cardIdInput.evaluate(el => el.value = '');
        await cardIdInput.type(params.cardId, { delay: 50 });
        console.log('カードIDを入力:', params.cardId);
      } catch (error) {
        console.log('クリックできないため、JavaScriptで値を設定');
        await cardIdInput.evaluate((el, value) => {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, params.cardId);
        console.log('カードIDを入力（JavaScript経由）:', params.cardId);
      }
    }
    
    // カテゴリの選択
    if (params.category && categorySelect) {
      // カテゴリのマッピング
      const categoryMap = {
        'ポケモン': 'pokemon',
        'グッズ': 'goods',
        'ポケモンのどうぐ': 'tool',
        'サポート': 'support',
        'スタジアム': 'stadium',
        'エネルギー': 'energy'
      };
      const categoryValue = categoryMap[params.category] || params.category;
      
      try {
        await categorySelect.select(categoryValue);
        console.log('カテゴリを選択:', categoryValue);
      } catch (e) {
        // 選択できない場合は日本語の値で試す
        try {
          await categorySelect.select(params.category);
        } catch (e2) {
          console.log('カテゴリの選択に失敗:', e2.message);
        }
      }
    }
    
    // 検索ボタンを探す
    const buttonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button.search-button',
      'button.btn-search',
      '.search-button',
      '.btn-search',
      'button:contains("検索")',
      'input[value*="検索"]'
    ];
    
    for (const selector of buttonSelectors) {
      searchButton = await page.$(selector);
      if (searchButton) {
        console.log('検索ボタンを見つけました:', selector);
        break;
      }
    }
    
    // 検索ボタンをクリック
    if (searchButton) {
      try {
        // ボタンを表示領域にスクロール
        await searchButton.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // ボタンをクリック
        await searchButton.click();
        console.log('検索ボタンをクリック');
        
        // 検索結果の読み込みを待つ（PCGDECKオブジェクトまたは結果要素の出現を待つ）
        try {
          await page.waitForFunction(
            () => {
              return (window.PCGDECK && window.PCGDECK.searchItemName) ||
                     document.querySelector('.card-item, .search-result, [data-card-id], .result-item, table tbody tr');
            },
            { timeout: 15000 }
          );
          console.log('検索結果の読み込み完了');
        } catch (e) {
          console.log('検索結果の待機タイムアウト、続行します');
        }
      } catch (error) {
        // クリックできない場合は、JavaScriptで直接クリックイベントを発火
        console.log('クリックできないため、JavaScriptで検索を実行');
        await searchButton.evaluate(button => {
          button.click();
        });
        console.log('検索ボタンをクリック（JavaScript経由）');
        
        // 検索結果の読み込みを待つ
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          await page.waitForFunction(
            () => {
              return (window.PCGDECK && window.PCGDECK.searchItemName) ||
                     document.querySelector('.card-item, .search-result, [data-card-id], .result-item, table tbody tr');
            },
            { timeout: 12000 }
          );
          console.log('検索結果の読み込み完了');
        } catch (e) {
          console.log('検索結果の待機タイムアウト、続行します');
        }
      }
    } else {
      // 検索ボタンが見つからない場合、Enterキーで送信を試みる
      if (nameInput) {
        await nameInput.press('Enter');
        console.log('Enterキーで検索を実行');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        // フォームを直接送信
        const form = await page.$('form');
        if (form) {
          await form.evaluate(form => form.submit());
          console.log('フォームを送信');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
    
    // リクエスト間隔を設ける
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
    
    // 追加の待機（JavaScriptの実行を待つ）
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // PCGDECKオブジェクトが更新されるまで待つ（最大5秒）
    let cards = [];
    for (let i = 0; i < 5; i++) {
      cards = await extractCardsFromPage(page);
      if (cards.length > 0) {
        console.log(`検索結果: ${cards.length}件のカードを取得`);
        break;
      }
      console.log(`検索結果の待機中... (${i + 1}/5)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (cards.length === 0) {
      console.log('検索結果が見つかりませんでした。ページのHTMLを確認します...');
      // デバッグ用: ページのHTML構造を確認
      const debugInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          hasPCGDECK: !!window.PCGDECK,
          PCGDECKKeys: window.PCGDECK ? Object.keys(window.PCGDECK) : [],
          searchResults: {
            cardItems: document.querySelectorAll('.card-item, .search-result, [data-card-id], .result-item, table tbody tr').length,
            tables: document.querySelectorAll('table').length,
            lists: document.querySelectorAll('ul, ol').length
          },
          bodyText: document.body.innerText.substring(0, 500) // 最初の500文字
        };
      });
      console.log('デバッグ情報:', JSON.stringify(debugInfo, null, 2));
      
      // スクリーンショットを保存（デバッグ用）
      try {
        await page.screenshot({ path: 'debug-search-page.png', fullPage: false });
        console.log('スクリーンショットを保存: debug-search-page.png');
      } catch (e) {
        console.log('スクリーンショットの保存に失敗:', e.message);
      }
    }
    
    return cards;
  } catch (error) {
    console.error('検索エラー:', error);
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      throw new TimeoutError('検索のタイムアウトが発生しました');
    }
    if (error.message.includes('net::ERR') || error.message.includes('ECONNREFUSED')) {
      throw new NetworkError('ネットワークエラーが発生しました');
    }
    throw error;
  } finally {
    await page.close();
  }
}
