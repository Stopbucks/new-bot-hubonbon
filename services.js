/**
 * ==============================================================================
 * 🛠️ Info Commander Service Module (Big 1.5 Engine)
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-23   Ver 1223_07   Previous Base: YouTube Client Web Mode.
 * 2025-12-24   Ver 1224_08   Feature Add: 實作 YouTube Data API + Google Search.
 * Fix: 針對學生專案，強制鎖定模型為 gemini-3-flash-preview。
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 初始化設定 ---

// 1. YouTube API 設定 (使用雲端萬用鑰匙)
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.GOOGLE_CLOUD_API_KEY
});

// 2. Gemini 設定 (使用新申請的專用 Key)
// ⚠️ Critical Fix: 依照 Ver 1223_05 日誌，鎖定 gemini-3-flash-preview 模型
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_NEW);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// ==========================================
// 功能 A: 搜尋 YouTube 影片 (來源層)
// ==========================================
async function searchYouTube(keyword) {
    try {
        console.log(`[YouTube API] 正在搜尋: ${keyword}...`);
        
        const res = await youtube.search.list({
            part: 'snippet',
            q: keyword,
            order: 'viewCount',       // 找最熱門的
            type: 'video',
            relevanceLanguage: 'zh-Hant', // 偏好繁體中文
            publishedAfter: '2024-01-01T00:00:00Z', // 確保是今年以後的
            maxResults: 1
        });

        if (!res.data.items || res.data.items.length === 0) {
            console.log('[YouTube API] 找不到相關影片');
            return null;
        }

        const video = res.data.items[0];
        // 回傳標準化資料
        return {
            title: video.snippet.title,
            description: video.snippet.description,
            channel: video.snippet.channelTitle,
            publishTime: video.snippet.publishedAt,
            url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
            videoId: video.id.videoId
        };

    } catch (error) {
        console.error('[YouTube API Error]', error.message);
        return null;
    }
}

// ==========================================
// 功能 B: 搜尋 Google 網路新聞 (偵查層)
// ==========================================
async function searchGoogle(query) {
    try {
        console.log(`[Google Search API] 正在偵查: ${query}...`);
        
        const url = 'https://www.googleapis.com/customsearch/v1';
        const params = {
            key: process.env.GOOGLE_CLOUD_API_KEY, // 萬用鑰匙
            cx: process.env.SEARCH_ENGINE_ID,      // 搜尋引擎 ID
            q: query,
            num: 3 // 只抓前 3 筆最相關的
        };

        const res = await axios.get(url, { params });
        
        if (!res.data.items) return [];

        // 精簡回傳資料
        return res.data.items.map(item => ({
            title: item.title,
            snippet: item.snippet,
            link: item.link
        }));

    } catch (error) {
        console.error('[Google Search API Error]', error.message);
        return [];
    }
}

// ==========================================
// 功能 C: Gemini 綜合分析 (大腦層)
// ==========================================
async function generateAnalysis(videoData, newsData) {
    try {
        console.log(`[Gemini] 正在呼叫模型 (gemini-3-flash-preview) 進行綜合分析...`);

        // 將新聞資料轉為字串
        const newsContext = newsData.map((n, i) => 
            `${i+1}. [${n.title}]: ${n.snippet}`
        ).join('\n');

        const prompt = `
        你是一位專業的新聞情報分析師。
        
        【資料來源 A：熱門 YouTube 影片】
        標題：${videoData.title}
        頻道：${videoData.channel}
        描述：${videoData.description}

        【資料來源 B：網路搜尋結果 (查證與補充)】
        ${newsContext}

        【任務要求】
        請綜合以上資訊，寫一篇「社群情報快訊」。
        1. **標題**：請下一個吸睛的標題 (使用 " ▌ " 開頭)。
        2. **核心摘要**：用 100 字左右總結這件事發生了什麼。
        3. **關聯情報偵測**：根據搜尋結果，補充影片沒提到的細節、或是媒體的不同觀點。
        4. **語氣**：專業、客觀但易讀。
        `;

        const result = await model.generateContent(prompt);
        return result.response.text();

    } catch (error) {
        console.error('[Gemini Error]', error.message);
        return "⚠️ 分析生成失敗，請檢查 API 配額或 Log (確認模型名稱是否正確)。";
    }
}

// 匯出功能
module.exports = { searchYouTube, searchGoogle, generateAnalysis };