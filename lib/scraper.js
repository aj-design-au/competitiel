'use strict';

const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Dollar/pound/euro amounts
const PRICE_RE = /(?:[\$£€])\s*([\d,]+(?:\.\d{1,2})?)/g;

function extractFromJsonLd(text) {
  const prices = [];
  try {
    const data = JSON.parse(text);
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      if (node['@type'] === 'Product' || node['@type'] === 'Offer') {
        const offer = node.offers || node;
        const arr   = Array.isArray(offer) ? offer : [offer];
        for (const o of arr) {
          if (o && o.price != null) {
            prices.push({ label: node.name || 'Product', price: String(o.price), currency: o.priceCurrency || '', source: 'json-ld' });
          }
        }
      }
    }
  } catch {}
  return prices;
}

function dedupe(prices) {
  const seen = new Set();
  return prices.filter(p => {
    const key = p.price;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Scrape a single URL and return extracted price data.
 * @param {string} url
 * @returns {{ success: boolean, url: string, prices: Array, title: string, error?: string, timestamp: string }}
 */
async function scrapeUrl(url) {
  const timestamp = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const html = await res.text();
    const $    = cheerio.load(html);
    const title = $('title').first().text().trim().slice(0, 120);
    const prices = [];

    // 1. JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      prices.push(...extractFromJsonLd($(el).text()));
    });

    // 2. OpenGraph product price
    const ogPrice    = $('meta[property="product:price:amount"]').attr('content');
    const ogCurrency = $('meta[property="product:price:currency"]').attr('content') || '';
    if (ogPrice) prices.push({ label: title, price: ogPrice, currency: ogCurrency, source: 'og-meta' });

    // 3. itemprop="price"
    $('[itemprop="price"]').each((_, el) => {
      const val = $(el).attr('content') || $(el).text().trim();
      if (val) prices.push({ label: $('[itemprop="name"]').first().text().trim() || title, price: val, source: 'itemprop' });
    });

    // 4. Platform-specific selectors
    const selectors = [
      // Generic
      '.price',
      '[class*="price"]:not(script):not(style)',
      '[class*="Price"]:not(script):not(style)',
      '[data-price]',
      // Shopify
      '.product__price',
      '.price__current',
      // WooCommerce
      '.woocommerce-Price-amount',
      // Amazon
      '.a-price > .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      // eBay
      '#prcIsum',
      '.notranslate[id*="price"]',
      // Etsy
      '[data-selector="price-only"]',
      '.currency-value',
    ];

    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const text = ($(el).attr('content') || $(el).text()).trim();
        if (!text) return;
        const matches = [...text.matchAll(PRICE_RE)];
        for (const m of matches) {
          prices.push({ label: title, price: m[0].replace(/\s/g, ''), source: `selector:${sel}` });
        }
      });
    }

    // 5. Regex fallback across the visible body text
    if (prices.length === 0) {
      const bodyText = $('body').text();
      const matches  = [...bodyText.matchAll(PRICE_RE)];
      const unique   = [...new Set(matches.map(m => m[0].replace(/\s/g, '')))].slice(0, 15);
      unique.forEach(p => prices.push({ label: title, price: p, source: 'regex' }));
    }

    return { success: true, url, title, prices: dedupe(prices), timestamp };
  } catch (err) {
    return { success: false, url, title: '', prices: [], error: err.message, timestamp };
  }
}

/**
 * Scrape a competitor (site URL and optional product page).
 */
async function scrapeCompetitor(competitor) {
  const urls = [competitor.website_url];
  if (competitor.product_url && competitor.product_url !== competitor.website_url) {
    urls.push(competitor.product_url);
  }

  const results = await Promise.all(urls.map(u => scrapeUrl(u)));
  return { competitor_id: competitor.id, results, timestamp: new Date().toISOString() };
}

module.exports = { scrapeUrl, scrapeCompetitor };
