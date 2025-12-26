/**
 * ==============================================================================
 * 🛠️ Info Commander Services (The Logic Core)
 * ==============================================================================
 * [Version]     Big 1+2+3 Unified (Full Armor)
 * [Model]       gemini-3-flash-preview
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse'); 

// --- 初始化 ---
const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// 工具：計算日期
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

// 延遲工具
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// A. 智能搜圖路由
// ==========================================
async function fetchSmartImage(keyword, type) {
    try {
        // 路線 A: Unsplash
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
            const res = await axios.get(unsplashUrl);
            if (res.data.results?.[0]) return res.data.results[0].urls.regular;
        }
        // 路線 B: Google Search
        const googleUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`;
        const res = await axios.get(googleUrl);
        if (res.data.items?.[0]) return res.data.items[0].link;
        
        return null;
    } catch (e) {
        console.error(`[Image Error] ${e.message}`);
        return null; 
    }
}

// ==========================================
// B. Gemini 核心分析 (Brain)
// ==========================================

// B-1. Gate-Room 改寫 (社群貼文)
async function processGateMessage(rawText, sourceUrl = "") {
    console.log("[Gate] Gemini 改寫中...");
    const prompt = `
    你是一個社群小編。請將以下內容改寫為 Facebook 貼文：
    【來源內容】：${rawText}
    
    請輸出 **純 JSON**：
    1. "content": 貼文內容。
       - 標題用 "  ▌ " 開頭。
       - 150 字以內，精簡犀利。
       - 加上 Hashtag。
    2. "image_decision": { "type": "news"或"concept", "keyword": "英文搜尋關鍵字" }
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(text);
        const imageUrl = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);
        return { content: json.content, imageUrl: imageUrl, sourceUrl: sourceUrl };
    } catch (e) { console.error("[Gate Error]", e.message); return null; }
}

// B-2. PDF 摘要
async function processPDF(fileUrl) {
    try {
        console.log("[Service] 下載 PDF...");
        const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const data = await PdfParse(response.data);
        const rawText = data.text;
        if (!rawText || rawText.length < 50) return "⚠️ 無法讀取文字。";

        const cleanText = rawText.substring(0, 20000); 
        const prompt = `請閱讀並整理這份 PDF 的重點摘要 (繁體中文)：\n\n${cleanText}`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return "❌ PDF 處理失敗。"; }
}

// B-3. 自動化情報分析 (Big 2 核心)
async function generateAnalysisV2(ytData, newsData) {
    console.log(`[Auto] 分析議題: ${ytData.title}`);
    const prompt = `
    你是一個情報分析師。請綜合以下資訊寫成一篇快訊：
    【YouTube 熱門】：${ytData.title}
    【相關新聞】：${newsData}

    請輸出 **純 JSON**：
    1. "content": 適合發布在 Telegram 的短訊 (含標題 "▌ 每日情報")。
    2. "image_decision": { "type": "news", "keyword": "${ytData.title}" }
    `;
    
    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return null; }
}

// ==========================================
// C. 外部爬蟲 (Big 2 復原)
// ==========================================
async function searchYouTube(keyword) {
    try {
        const res = await youtube.search.list({
            part: 'snippet', q: keyword, order: 'viewCount', type: 'video',
            relevanceLanguage: 'zh-Hant', publishedAfter: getDateDaysAgo(2), maxResults: 1
        });
        if (!res.data.items?.length) return null;
        const v = res.data.items[0];
        return { title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id.videoId}` };
    } catch (e) { return null; }
}

async function searchGoogle(query) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key: googleKey, cx: process.env.SEARCH_ENGINE_ID, q: query, num: 3 }
        });
        return res.data.items ? res.data.items.map(i => `${i.title}: ${i.snippet}`).join('\n') : "";
    } catch (e) { return ""; }
}

// RSS 熱搜
async function getGlobalTrends(geo = 'TW') {
    try {
        const rssUrl = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`;
        const res = await axios.get(rssUrl);
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        const titleRegex = /<title>(.*?)<\/title>/;
        let match;
        while ((match = itemRegex.exec(res.data)) !== null) {
            const titleMatch = titleRegex.exec(match[1]);
            if (titleMatch) items.push({ title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '') });
        }
        return items.slice(0, 10);
    } catch (e) { return []; }
}

async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ part: 'snippet', chart: 'mostPopular', regionCode: regionCode, maxResults: 5 });
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}` }));
    } catch (e) { return []; }
}

async function checkChannelLatestVideo(channelId) {
    try {
        const res = await youtube.search.list({
            part: 'snippet', channelId: channelId, order: 'date', type: 'video',
            publishedAfter: getDateDaysAgo(1), maxResults: 1
        });
        if (!res.data.items?.length) return [];
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id.videoId}` }));
    } catch (e) { return []; }
}

// Make 發送
async function dispatchToMake(payload) {
    if (process.env.MAKE_WEBHOOK_URL) await axios.post(process.env.MAKE_WEBHOOK_URL, payload).catch(e=>console.error(e));
}

module.exports = {
    processGateMessage, processPDF, generateAnalysisV2,
    searchYouTube, searchGoogle, getGlobalTrends, getMostPopularVideos, checkChannelLatestVideo,
    fetchSmartImage, dispatchToMake
};