/**
 * ==============================================================================
 * 🛠️ Info Commander Service Module (Big 1.5 Engine)
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-23   Ver 1223_07   Previous Base: YouTube Client Web Mode.
 * 2025-12-24   Ver 1224_08   Feature Add: 實作 YouTube Data API + Google Search.
 * Fix: 針對學生專案，強制鎖定模型為 gemini-3-flash-preview。
 * ==============================================================================
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-24   Ver 1224_11   Feature: searchYouTube 支援動態天數 (days)。
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const youtube = google.youtube({ version: 'v3', auth: process.env.GOOGLE_CLOUD_API_KEY });
// 鎖定使用 gemini-3-flash-preview
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_NEW);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// 📅 小工具：計算幾天前的 ISO 日期
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

// ==========================================
// 功能 A: 搜尋 YouTube (支援天數過濾)
// ==========================================
async function searchYouTube(keyword, days = 5) { // 預設 5 天
    try {
        const publishedAfter = getDateDaysAgo(days);
        console.log(`[YouTube API] 搜尋: "${keyword}" (範圍: 過去 ${days} 天, Since: ${publishedAfter.split('T')[0]})`);
        
        const res = await youtube.search.list({
            part: 'snippet',
            q: keyword,
            order: 'viewCount',
            type: 'video',
            relevanceLanguage: 'zh-Hant',
            publishedAfter: publishedAfter, // ✅ 動態時間
            maxResults: 1
        });

        if (!res.data.items || res.data.items.length === 0) {
            console.log('[YouTube API] 找不到相關影片');
            return null;
        }

        const video = res.data.items[0];
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
// 功能 B: 搜尋 Google (不變)
// ==========================================
async function searchGoogle(query) {
    try {
        console.log(`[Google Search API] 偵查: ${query}...`);
        const url = 'https://www.googleapis.com/customsearch/v1';
        const params = {
            key: process.env.GOOGLE_CLOUD_API_KEY,
            cx: process.env.SEARCH_ENGINE_ID,
            q: query, num: 3
        };
        const res = await axios.get(url, { params });
        if (!res.data.items) return [];
        return res.data.items.map(item => ({ title: item.title, snippet: item.snippet, link: item.link }));
    } catch (error) {
        console.error('[Google Search API Error]', error.message);
        return [];
    }
}

// ==========================================
// 功能 C: Gemini 分析 (不變)
// ==========================================
async function generateAnalysis(videoData, newsData) {
    try {
        console.log(`[Gemini] 進行綜合分析...`);
        const newsContext = newsData.map((n, i) => `${i+1}. [${n.title}]: ${n.snippet}`).join('\n');
        const prompt = `
        你是一位專業的新聞情報分析師。
        【資料來源 A：熱門 YouTube 影片】
        標題：${videoData.title} (頻道: ${videoData.channel})
        描述：${videoData.description}
        【資料來源 B：網路搜尋結果】
        ${newsContext}
        【任務要求】
        請綜合以上資訊，寫一篇「社群情報快訊」。
        1. **標題**：請下一個吸睛的標題 (使用 " ▌ " 開頭)。
        2. **核心摘要**：用 100 字左右總結這件事發生了什麼。
        3. **關聯情報偵測**：根據搜尋結果，補充影片沒提到的細節或不同觀點。
        4. **語氣**：專業、客觀但易讀。
        `;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('[Gemini Error]', error.message);
        return "⚠️ 分析生成失敗，請檢查 API 配額或 Log。";
    }
}

module.exports = { searchYouTube, searchGoogle, generateAnalysis };