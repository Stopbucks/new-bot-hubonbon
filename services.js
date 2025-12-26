/**
 * ==============================================================================
 * 🛠️ Info Commander Services (War Room Big 2 + Big 3 Integrated)
 * ==============================================================================
 * [Version]     Big 3 Bridge-Gate Edition (Full)
 * [Last Update] 2025-12-26
 * [Model]       gemini-3-flash-preview
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 初始化 ---
const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ 指定模型
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// 工具：計算時間
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

// ==========================================
// A. 智能搜圖路由 (Smart Image Router)
// ==========================================
async function fetchSmartImage(keyword, type) {
    try {
        console.log(`[Image Router] 請求: ${keyword} (Type: ${type})`);

        // 路線 A: Unsplash (意境/概念)
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
            const res = await axios.get(unsplashUrl);
            if (res.data.results && res.data.results.length > 0) {
                return res.data.results[0].urls.regular;
            }
        }
        
        // 路線 B: Google Custom Search (新聞/備援)
        const googleUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`;
        const res = await axios.get(googleUrl);
        if (res.data.items && res.data.items.length > 0) {
            return res.data.items[0].link;
        }
        
        return null;
    } catch (e) {
        console.error(`[Image Error] ${e.message}`);
        return null; 
    }
}

// ==========================================
// B. Gemini 核心分析 (Brain)
// ==========================================

// B-1. 綜合分析 (適用於每日議題/熱搜)
async function generateAnalysisV2(ytData, newsData) {
    const prompt = `
    你是一個全球情報分析師。請針對以下素材進行分析：
    【YouTube 標題】：${ytData.title}
    【相關新聞】：${newsData}

    請輸出一個 **純 JSON 格式** 的回應 (不要 Markdown)，包含：
    1. "content": 一篇繁體中文社群貼文。
       - 標題以 "  ▌ " 開頭。
       - 倒金字塔風格，段落間空一行，語氣專業但易讀。
       - 300字以內。
       - 最後一段列出參考來源。
    2. "image_decision": 一個物件 { "type": "news"或"concept", "keyword": "英文搜尋關鍵字" }。
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        console.error("[Gemini Error]", e.message);
        return { content: `⚠️ 分析失敗: ${ytData.title}`, image_decision: { type: "news", keyword: ytData.title } };
    }
}

// B-2. Gate-Room 專用改寫 (Big 3 新增)
async function processGateMessage(rawText, sourceUrl = "") {
    console.log("[Gate-Room] Gemini 正在改寫...");
    const prompt = `
    你是一個社群小編。請將以下內容改寫為 Facebook 貼文：
    【來源內容】：${rawText}
    
    請輸出 **純 JSON**：
    1. "content": 貼文內容。
       - 標題用 "  ▌ " 開頭。
       - 加上適當 Emoji 與 Hashtag。
       - 若有來源網址，請放在最後一行。
    2. "image_decision": { "type": "news"或"concept", "keyword": "英文關鍵字" }
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(text);

        // 自動配圖
        const imageUrl = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);
        
        return {
            content: json.content,
            imageUrl: imageUrl, 
            sourceUrl: sourceUrl
        };
    } catch (e) {
        console.error("[Gate Error]", e.message);
        return null;
    }
}

// ==========================================
// C. 外部數據源 (YouTube / RSS)
// ==========================================
async function searchYouTube(keyword, days = 5) {
    try {
        const res = await youtube.search.list({
            part: 'snippet', q: keyword, order: 'viewCount', type: 'video',
            relevanceLanguage: 'zh-Hant', publishedAfter: getDateDaysAgo(days), maxResults: 1
        });
        if (!res.data.items?.length) return null;
        const v = res.data.items[0];
        return { title: v.snippet.title, description: v.snippet.description, url: `https://www.youtube.com/watch?v=${v.id.videoId}` };
    } catch (e) { return null; }
}

async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ part: 'snippet', chart: 'mostPopular', regionCode: regionCode, maxResults: 3 });
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}` }));
    } catch (e) { return []; }
}

async function checkChannelLatestVideo(channelId) {
    try {
        const res = await youtube.search.list({
            part: 'snippet', channelId: channelId, order: 'date', type: 'video',
            publishedAfter: getDateDaysAgo(1), maxResults: 3
        });
        if (!res.data.items?.length) return [];
        return res.data.items.map(v => ({
            title: v.snippet.title,
            description: v.snippet.description,
            url: `https://www.youtube.com/watch?v=${v.id.videoId}`
        }));
    } catch (e) { console.error(`Monitor Error ${channelId}: ${e.message}`); return []; }
}

async function searchGoogle(query) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key: googleKey, cx: process.env.SEARCH_ENGINE_ID, q: query, num: 3 }
        });
        return res.data.items ? res.data.items.map(i => `${i.title}: ${i.snippet}`).join('\n') : "";
    } catch (e) { return ""; }
}

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
            if (titleMatch) items.push({ title: titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, ''), source: 'RSS' });
        }
        return items.slice(0, 10);
    } catch (e) { console.error("RSS Error:", e.message); return []; }
}

// ==========================================
// D. Make 自動化發送
// ==========================================
async function dispatchToMake(payload) {
    if (!process.env.MAKE_WEBHOOK_URL) return;
    try {
        console.log(`[Make] 發送 Payload: ${payload.target}`);
        await axios.post(process.env.MAKE_WEBHOOK_URL, payload);
    } catch (e) { console.error(`[Make Error] ${e.message}`); }
}

// 匯出所有功能
module.exports = {
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo,
    searchGoogle, getGlobalTrends,
    generateAnalysisV2, processGateMessage, fetchSmartImage, dispatchToMake
};