/**
 * カード詳細情報の取得
 */

import { createPage } from '../utils/browser.js';
import { NotFoundError, TimeoutError, NetworkError } from '../utils/errors.js';

const REQUEST_DELAY = 1000; // 1秒

const ENERGY_TYPE_LABELS = [
  { label: '草', value: '草' },
  { label: '炎', value: '炎' },
  { label: '水', value: '水' },
  { label: '雷', value: '雷' },
  { label: '超', value: '超' },
  { label: '闘', value: '闘' },
  { label: '悪', value: '悪' },
  { label: '鋼', value: '鋼' },
  { label: '無色', value: '無色' }
];

function detectEnergyTypeFromText(text) {
  if (!text) return null;
  const normalized = String(text).replace(/\s+/g, '');
  const types = ENERGY_TYPE_LABELS
    .filter(({ label }) => normalized.includes(label))
    .map(({ value }) => value);
  if (types.length === 0) return null;
  return Array.from(new Set(types)).join('/');
}

/**
 * ワザ情報を抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Waza[]>}
 */
async function extractWazaInfo(page) {
  return await page.evaluate(() => {
    const waza = [];
    const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();
    
    // ワザセクションを探す
    const wazaSection = Array.from(document.querySelectorAll('h2')).find(
      h2 => h2.textContent.includes('ワザ')
    );
    
    if (!wazaSection) {
      return waza;
    }
    
    let current = wazaSection.nextElementSibling;
    
    while (current && current.tagName !== 'TABLE' && !current.textContent.includes('進化')) {
      if (current.tagName === 'H2') break; // 次のセクション（進化等）に入ったら終了
      if (current.tagName === 'H4') {
        const wazaElement = current;
        
        // エネルギーコストの抽出
        const energyCost = [];
        const energyIcons = wazaElement.querySelectorAll('span.icon, img');
        energyIcons.forEach((el) => {
          const className = el.className || '';
          const typeMatch = className.match(/icon-([a-z]+)/);
          if (typeMatch) {
            energyCost.push(typeMatch[1]);
            return;
          }
          const src = el.getAttribute('src') || '';
          const srcMatch = src.match(/energy\/([a-z]+)\.png/i);
          if (srcMatch) {
            energyCost.push(srcMatch[1].toLowerCase());
          }
        });
        
        // 技名の抽出（エネルギーアイコンとダメージを除く）
        const wazaNameFull = normalizeText(wazaElement.textContent);
        const wazaNameClean = normalizeText(
          wazaElement.textContent
            .replace(/\d+[\+\-\＋×]?/g, '')  // 数値と付加記号（＋・×）を除去
            .replace(/icon-[a-z]+/g, '')
        );
        
        // ダメージの抽出（数値の直後の ＋ または × も取得）
        const damageMatch = wazaNameFull.match(/(\d+)(＋|×)?$/);
        const damage = damageMatch ? parseInt(damageMatch[1]) : null;
        let damageModifier = null;
        if (damageMatch && damageMatch[2]) {
          damageModifier = damageMatch[2] === '＋' ? 'plus' : damageMatch[2] === '×' ? 'times' : null;
        }
        
        // 技の効果の抽出
        let effect = '';
        let next = current.nextElementSibling;
        if (next && next.tagName === 'P') {
          effect = next.textContent.trim();
        }
        
        waza.push({
          name: wazaNameFull,
          nameClean: wazaNameClean,
          energyCost: energyCost,
          damage: damage,
          damageModifier: damageModifier,
          effect: effect
        });
      }
      current = current.nextElementSibling;
    }
    
    return waza;
  });
}

/**
 * 特性情報を抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Ability[]>}
 */
async function extractAbilitiesInfo(page) {
  return await page.evaluate(() => {
    const abilities = [];
    const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();

    const abilitiesSection = Array.from(document.querySelectorAll('h2')).find(
      h2 => h2.textContent.includes('特性')
    );
    if (!abilitiesSection) return abilities;

    let current = abilitiesSection.nextElementSibling;
    while (current && current.tagName !== 'TABLE' && !current.textContent.includes('進化')) {
      if (current.tagName === 'H2') break; // 次のセクション（ワザ等）に入ったら終了
      if (current.tagName === 'H4') {
        const name = normalizeText(current.textContent);
        let effect = '';
        const next = current.nextElementSibling;
        if (next && next.tagName === 'P') {
          effect = normalizeText(next.textContent);
        }
        abilities.push({ name, effect });
      }
      current = current.nextElementSibling;
    }

    return abilities;
  });
}

/**
 * 基本情報を抽出（HP、進化段階など）
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Object>}
 */
async function extractBasicInfo(page) {
  return await page.evaluate(() => {
    const result = {
      hp: null,
      evolutionStage: null,
      type: null,
      category: null
    };

    const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();
    
    // HPの抽出
    const hpText = document.body.innerText.match(/HP\s*(\d+)/);
    if (hpText) {
      result.hp = parseInt(hpText[1]);
      result.category = 'ポケモン';
    }
    
    // 進化段階の抽出（CSSセレクターを優先）
    const typeElement = document.querySelector('span.type');
    if (typeElement) {
      const text = typeElement.textContent.trim();
      if (text === 'たね') {
        result.evolutionStage = 'たね';
      } else if (text.match(/^1\s*進化$/)) {
        result.evolutionStage = '1進化';
      } else if (text.match(/^2\s*進化$/)) {
        result.evolutionStage = '2進化';
      }
    }
    
    // CSSセレクターで取得できない場合のフォールバック
    if (!result.evolutionStage) {
      const bodyText = document.body.innerText;
      if (bodyText.match(/\bたね\b/)) {
        result.evolutionStage = 'たね';
      } else if (bodyText.match(/2\s*進化/)) {
        result.evolutionStage = '2進化';
      } else if (bodyText.match(/1\s*進化/)) {
        result.evolutionStage = '1進化';
      }
    }
    
    // タイプの抽出（ポケモンの場合）
    const typeIcon = document.querySelector('.type-icon, .pokemon-type');
    if (typeIcon) {
      const className = typeIcon.className || '';
      const typeMatch = className.match(/icon-([a-z]+)/);
      if (typeMatch) {
        const typeMap = {
          'grass': '草',
          'fire': '炎',
          'water': '水',
          'lightning': '雷',
          'psychic': '超',
          'fighting': '闘',
          'dark': '悪',
          'metal': '鋼',
          'colorless': '無色'
        };
        result.type = typeMap[typeMatch[1]] || typeMatch[1];
      }
    }

    // カテゴリの抽出（見出し優先）
    const headingTexts = Array.from(document.querySelectorAll('h2'))
      .map((el) => normalizeText(el.textContent));
    const categoryFromHeading = headingTexts.find((text) =>
      ['グッズ', 'ポケモンのどうぐ', 'サポート', 'スタジアム', '基本エネルギー', '特殊エネルギー'].some((label) => text.includes(label))
    );
    if (categoryFromHeading) {
      if (categoryFromHeading.includes('エネルギー')) {
        result.category = 'エネルギー';
      } else if (categoryFromHeading.includes('ポケモンのどうぐ')) {
        result.category = 'ポケモンのどうぐ';
      } else if (categoryFromHeading.includes('グッズ')) {
        result.category = 'グッズ';
      } else if (categoryFromHeading.includes('サポート')) {
        result.category = 'サポート';
      } else if (categoryFromHeading.includes('スタジアム')) {
        result.category = 'スタジアム';
      }
    }

    // カテゴリの抽出（HPがない場合のフォールバック）
    if (!result.category) {
      const bodyText = document.body ? document.body.innerText : '';
      const match = bodyText.match(/(グッズ|サポート|スタジアム|ポケモンのどうぐ|エネルギー)/);
      if (match) {
        result.category = match[1];
      }
    }
    
    return result;
  });
}

/**
 * 弱点・抵抗力・にげるコストを抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Object>}
 */
async function extractWeaknessResistance(page) {
  return await page.evaluate(() => {
    const result = {
      weakness: '',
      resistance: '',
      retreatCost: null
    };
    
    const tables = Array.from(document.querySelectorAll('table'));
    const target = tables.find((table) => {
      const header = table.querySelector('tr');
      if (!header) return false;
      const headText = header.textContent || '';
      return headText.includes('弱点') && headText.includes('抵抗力') && headText.includes('にげる');
    });
    if (!target) return result;

    const rows = target.querySelectorAll('tr');
    if (rows.length > 1) {
      const cells = rows[1].querySelectorAll('td');
      if (cells.length >= 3) {
        result.weakness = cells[0].textContent.trim();
        result.resistance = cells[1].textContent.trim();
        const retreatText = cells[2].textContent.trim();
        const retreatMatch = retreatText.match(/(\d+)/);
        if (retreatMatch) {
          result.retreatCost = parseInt(retreatMatch[1]);
        }
      }
    }
    
    return result;
  });
}

/**
 * セット情報を抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Object>}
 */
async function extractSetInfo(page) {
  return await page.evaluate(() => {
    const result = {
      setName: '',
      setCode: '',
      cardNumber: '',
      rarity: ''
    };
    
    const bodyText = document.body ? document.body.innerText : '';
    const cardNumberMatch = bodyText.match(/\b\d+\s*\/\s*\d+\b/);
    if (cardNumberMatch) {
      result.cardNumber = cardNumberMatch[0].replace(/\s+/g, '');
    }

    const regImg = document.querySelector('img[src*="/regulation_logo_"]');
    if (regImg) {
      const src = regImg.getAttribute('src') || '';
      const codeMatch = src.match(/\/([A-Za-z0-9]+)\.gif/);
      if (codeMatch) {
        result.setCode = codeMatch[1];
      }
    }

    const setLink = Array.from(document.querySelectorAll('a')).find((a) => {
      const href = a.getAttribute('href') || '';
      const text = (a.textContent || '').trim();
      return href.includes('/ex/') || text.includes('拡張パック') || text.includes('スターター');
    });
    if (setLink) {
      result.setName = setLink.textContent.trim();
    }
    
    // レアリティの抽出
    const rarityElement = document.querySelector('img[src*="/rarity/"], .rarity, .card-rarity');
    if (rarityElement) {
      const text = rarityElement.textContent ? rarityElement.textContent.trim() : '';
      const src = rarityElement.getAttribute ? (rarityElement.getAttribute('src') || '') : '';
      if (text) {
        result.rarity = text;
      } else if (src) {
        const match = src.match(/ic_rare_([a-z0-9_]+)\./i);
        if (match) {
          result.rarity = match[1];
        }
      }
    }
    
    return result;
  });
}

/**
 * 効果本文・エネルギー種別を抽出
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Object>}
 */
async function extractEffectInfo(page) {
  return await page.evaluate(() => {
    const result = {
      effectText: '',
      energySubtype: null
    };
    const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();
    const headings = Array.from(document.querySelectorAll('h2'));
    const target = headings.find((h2) => {
      const text = normalizeText(h2.textContent);
      return (
        text.includes('グッズ') ||
        text.includes('ポケモンのどうぐ') ||
        text.includes('サポート') ||
        text.includes('スタジアム') ||
        text.includes('基本エネルギー') ||
        text.includes('特殊エネルギー')
      );
    });
    if (!target) return result;

    const headingText = normalizeText(target.textContent);
    if (headingText.includes('基本エネルギー')) {
      result.energySubtype = '基本';
    } else if (headingText.includes('特殊エネルギー')) {
      result.energySubtype = '特殊';
    }

    const parts = [];
    let current = target.nextElementSibling;
    while (current && current.tagName !== 'H2') {
      const text = normalizeText(current.textContent);
      if (text) {
        parts.push(text);
      }
      current = current.nextElementSibling;
    }
    result.effectText = parts.join('\n');

    return result;
  });
}

/**
 * プロフィール情報を抽出（図鑑番号・イラストレーター）
 * @param {puppeteer.Page} page - Puppeteerページ
 * @returns {Promise<Object>}
 */
async function extractProfileInfo(page) {
  return await page.evaluate(() => {
    const result = {
      pokemonNumber: null,
      illustrator: ''
    };
    const bodyText = document.body ? document.body.innerText : '';
    const numberMatch = bodyText.match(/No\.\s*(\d+)/);
    if (numberMatch) {
      result.pokemonNumber = numberMatch[1];
    }

    const label = Array.from(document.querySelectorAll('h4, h3, p, span, div')).find((el) => {
      return (el.textContent || '').includes('イラストレーター');
    });
    if (label) {
      const link = label.querySelector('a') || (label.nextElementSibling && label.nextElementSibling.querySelector('a'));
      if (link) {
        result.illustrator = link.textContent.trim();
      } else {
        result.illustrator = label.textContent.replace('イラストレーター', '').trim();
      }
    }

    return result;
  });
}

/**
 * カード詳細情報を取得
 * @param {string} cardId - カードID（5桁）
 * @param {string} [regulation] - レギュレーション（オプション）
 * @returns {Promise<CardDetail>}
 */
export async function getCardDetail(cardId, regulation = 'SV') {
  const page = await createPage();
  
  try {
    // カード詳細ページのURLを構築
    let detailUrl = `https://www.pokemon-card.com/card-search/details.php/card/${cardId}/`;
    if (regulation) {
      detailUrl += `regu/${regulation}/`;
    }
    
    // ページにアクセス
    await page.goto(detailUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // ページが存在するか確認
    const pageTitle = await page.title();
    if (pageTitle.includes('404') || pageTitle.includes('見つかりません')) {
      throw new NotFoundError(`カードID ${cardId} が見つかりませんでした`);
    }
    
    // ワザセクションが表示されるまで待機
    await page.waitForSelector('h2, h1', { timeout: 10000 }).catch(() => {
      // セレクターが見つからない場合は続行
    });
    
    // リクエスト間隔を設ける
    await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
    
    // 各種情報を抽出
    const [wazaInfo, abilitiesInfo, basicInfo, weaknessResistance, setInfo, profileInfo, effectInfo] = await Promise.all([
      extractWazaInfo(page),
      extractAbilitiesInfo(page),
      extractBasicInfo(page),
      extractWeaknessResistance(page),
      extractSetInfo(page),
      extractProfileInfo(page),
      extractEffectInfo(page)
    ]);

    // カード名を取得
    const cardName = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent.trim() : '';
    });
    
    // 画像URLを取得（PCGDECKオブジェクトから）
    const imageUrl = await page.evaluate((id) => {
      if (window.PCGDECK && window.PCGDECK.searchItemCardPict && window.PCGDECK.searchItemCardPict[id]) {
        const relativePath = window.PCGDECK.searchItemCardPict[id];
        return 'https://www.pokemon-card.com' + relativePath;
      }
      return null;
    }, cardId);

    const isEnergy = basicInfo.category === 'エネルギー' || cardName.includes('エネルギー');
    const energyType = isEnergy
      ? detectEnergyTypeFromText(`${cardName}\n${effectInfo.effectText || ''}`)
      : null;
    const cardType = energyType || basicInfo.type;
    
    // カード詳細情報を構築
    const cardDetail = {
      cardId,
      name: cardName.split('(')[0].trim(),
      fullName: cardName,
      category: basicInfo.category || '不明',
      imageUrl,
      detailUrl,
      type: cardType,
      hp: basicInfo.hp,
      evolutionStage: basicInfo.evolutionStage,
      pokemonNumber: profileInfo.pokemonNumber,
      weakness: weaknessResistance.weakness,
      resistance: weaknessResistance.resistance,
      retreatCost: weaknessResistance.retreatCost,
      setName: setInfo.setName,
      setCode: setInfo.setCode,
      cardNumber: setInfo.cardNumber,
      rarity: setInfo.rarity,
      illustrator: profileInfo.illustrator,
      effectText: effectInfo.effectText,
      energySubtype: effectInfo.energySubtype,
      waza: wazaInfo,
      abilities: abilitiesInfo
    };
    
    return cardDetail;
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      throw new TimeoutError('カード詳細の取得がタイムアウトしました');
    }
    if (error.message.includes('net::ERR') || error.message.includes('ECONNREFUSED')) {
      throw new NetworkError('ネットワークエラーが発生しました');
    }
    throw error;
  } finally {
    await page.close();
  }
}
