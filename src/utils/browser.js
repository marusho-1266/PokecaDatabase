/**
 * ブラウザインスタンスの管理（Playwright）
 */

import { chromium } from 'playwright';

let browserInstance = null;
let contextInstance = null;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * ブラウザインスタンスを取得（シングルトン）
 * @returns {Promise<import('playwright').Browser>}
 */
export async function getBrowser() {
  if (!browserInstance) {
    const headless = process.env.HEADLESS !== 'false';
    browserInstance = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }
  return browserInstance;
}

/**
 * ブラウザコンテキストを取得（シングルトン）
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext() {
  const browser = await getBrowser();
  if (!contextInstance) {
    contextInstance = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: 'ja-JP'
    });
  }
  return contextInstance;
}

/**
 * ブラウザインスタンスを閉じる
 */
export async function closeBrowser() {
  if (contextInstance) {
    await contextInstance.close().catch(() => {});
    contextInstance = null;
  }
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * 新しいページを作成
 * @returns {Promise<import('playwright').Page>}
 */
export async function createPage() {
  const context = await getContext();
  const page = await context.newPage();
  return page;
}
