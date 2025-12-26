/**
 * ==============================================================================
 * 🛠️ Info Commander Services
 * ==============================================================================
 * [Version]     1226_Simple_Principle
 * [Feature]     PDF / Web(Violent) / Gate / Auto-Schedule
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse'); 

const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const getDateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// A. 搜圖
async function fetchSmartImage(keyword, type) {
    try {
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`);
            if (res.data.results?.[0]) return res.data.results[0].urls.regular;
        }
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`);
        if (res.data.items?.[0]) return res.data.items[0].link;
        return null;
    } catch (e) { return null; }
}

// B. 讀取能力 (PDF & Web)
async function processUrl(url) { // 暴力直讀
    try {
        console.log(`[Service] Reading: ${url}`);
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const rawHtml = res.data.substring(0, 40000); // 取前4萬字
        const result = await model.generateContent(`請忽略HTML標籤，摘要這篇網頁文章(繁體中文)：\n${rawHtml}`);
        return result.response.text();
    } catch (e) { return "⚠️ 無法讀取網頁 (可能被阻擋)。"; }
}

async function processPDF(fileUrl) {
    try {
        console.log(`[Service] Reading PDF...`);
        const res = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const data = await PdfParse(res.data);
        const text = data.text.substring(0, 20000);
        const result = await model.generateContent(`請摘要這份 PDF 文件(繁體中文)：\n${text}`);
        return result.response.text();
    } catch (e) { return "❌ PDF 讀取失敗"; }
}

// C. Gate 改寫
async function processGateMessage(rawText) {
    try {
        const result = await model.generateContent(`
        改寫為 FB 貼文 (純JSON):
        {"content": "含標題( ▌ ), Emoji, Hashtag, 150字內", "image_decision": {"type":"news/concept", "keyword":"en_keyword"}}
        \n內容: ${rawText}`);
        const json = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
        const img = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);
        return { content: json.content, imageUrl: img };
    } catch (e) { return null; }
}

// D. 自動化分析 (早晨用)
async function generateAnalysisV2(ytData, newsData) {
    try {
        const result = await model.generateContent(`
        綜合寫成每日情報快訊 (純JSON):
        {"content": "標題(▌ 每日情報), 內容", "image_decision": {"type":"news", "keyword":"${ytData.title}"}}
        \nYouTube: ${ytData.title}\nNews: ${newsData}`);
        return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (e) { return null; }
}

// E. 自動化爬蟲 (保留給排程用)
async function searchYouTube(keyword) {
    try {
        const res = await youtube.search.list({ part: 'snippet', q: keyword, order: 'viewCount', type: 'video', publishedAfter: getDateDaysAgo(2), maxResults: 1 });
        return res.data.items?.[0] ? { title: res.data.items[0].snippet.title, url: `https://www.youtube.com/watch?v=${res.data.items[0].id.videoId}` } : null;
    } catch (e) { return null; }
}
async function searchGoogle(q) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', { params: { key: googleKey, cx: process.env.SEARCH_ENGINE_ID, q, num: 3 } });
        return res.data.items ? res.data.items.map(i => i.snippet).join('\n') : "";
    } catch (e) { return ""; }
}
async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ part: 'snippet', chart: 'mostPopular', regionCode, maxResults: 5 });
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}` }));
    } catch (e) { return []; }
}
async function checkChannelLatestVideo(channelId) {
    try {
        const res = await youtube.search.list({ part: 'snippet', channelId, order: 'date', type: 'video', publishedAfter: getDateDaysAgo(1), maxResults: 1 });
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id.videoId}` }));
    } catch (e) { return []; }
}
async function getGlobalTrends(geo) {
    try {
        const res = await axios.get(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`);
        const matches = [...res.data.matchAll(/<title>(.*?)<\/title>/g)];
        return matches.slice(1, 11).map(m => ({ title: m[1].replace(/<!\[CDATA\[|\]\]>/g, '') }));
    } catch (e) { return []; }
}
async function dispatchToMake(payload) {
    if (process.env.MAKE_WEBHOOK_URL) await axios.post(process.env.MAKE_WEBHOOK_URL, payload).catch(e=>{});
}

module.exports = {
    processGateMessage, processPDF, processUrl, generateAnalysisV2,
    searchYouTube, searchGoogle, getGlobalTrends, getMostPopularVideos, checkChannelLatestVideo,
    fetchSmartImage, dispatchToMake
};