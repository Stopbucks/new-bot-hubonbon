/**
 * ==============================================================================
 * 🛠️ Info Commander Service Module (War Room Big 2 Edition)
 * ==============================================================================
 * [Development Log]
 * 2025-12-24 | Ver 1224_15 | Optimization: 移除舊版 XML 熱搜與舊分析函式.
 * 2025-12-25 | Ver 1225_16 | Fix: 統一變數名稱 GOOGLE_SEARCH_KEY.
 * 2025-12-25 | Ver 1225_17 | Model Upgrade: 全面切換至 Gemini 3 Flash Preview.
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 初始化 ---
const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });

const geminiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiKey);

// ✅ 這裡指定使用 Gemini 3 Flash Preview (同步 Server 設定)
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// 📅 工具：計算時間
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

// ==========================================
// A. YouTube 核心功能 (API Only)
// ==========================================

// A-1. 關鍵字搜尋
async function searchYouTube(keyword, days = 5) {
    try {
        const publishedAfter = getDateDaysAgo(days);
        console.log(`[YouTube API] 搜尋: "${keyword}" (Since: ${publishedAfter.split('T')[0]})`);
        
        const res = await youtube.search.list({
            part: 'snippet', q: keyword, order: 'viewCount', type: 'video',
            relevanceLanguage: 'zh-Hant', publishedAfter: publishedAfter, maxResults: 1
        });

        if (!res.data.items || res.data.items.length === 0) return null;
        const video = res.data.items[0];
        return {
            title: video.snippet.title,
            description: video.snippet.description,
            channel: video.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
            videoId: video.id.videoId
        };
    } catch (error) {
        console.error('[YouTube Search Error]', error.message);
        return null;
    }
}

// A-2. 取得地區熱門影片
async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({
            part: 'snippet', chart: 'mostPopular', regionCode: regionCode, maxResults: 3
        });
        return res.data.items.map(v => ({
            title: v.snippet.title,
            channel: v.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${v.id}`
        }));
    } catch (error) {
        console.error(`[YouTube Popular Error] Region: ${regionCode}`, error.message);
        return [];
    }
}

// A-3. 檢查頻道最新影片
async function checkChannelLatestVideo(channelId) {
    try {
        const res = await youtube.search.list({
            part: 'snippet', channelId: channelId, order: 'date', type: 'video',
            publishedAfter: getDateDaysAgo(1), maxResults: 3 
        });

        if (!res.data.items || res.data.items.length === 0) return []; 

        const videos = [];
        for (const video of res.data.items) {
            const detailRes = await youtube.videos.list({ part: 'snippet', id: video.id.videoId });
            const fullDesc = detailRes.data.items[0].snippet.description;

            videos.push({
                title: video.snippet.title,
                description: fullDesc,
                channel: video.snippet.channelTitle,
                url: `https://www.youtube.com/watch?v=${video.id.videoId}`
            });
        }
        return videos;
    } catch (error) {
        console.error(`[Channel Monitor Error] ID: ${channelId}`, error.message);
        return [];
    }
}

// ==========================================
// B. Google Search (輔助偵查)
// ==========================================
async function searchGoogle(query) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { 
                key: googleKey, 
                cx: process.env.SEARCH_ENGINE_ID, 
                q: query, 
                num: 3 
            }
        });
        if (!res.data.items) return [];
        return res.data.items.map(item => ({ title: item.title, snippet: item.snippet }));
    } catch (error) { return []; }
}

// ==========================================
// C. Gemini 輔助推測 (Gemini 3 Powered)
// ==========================================
async function generateInference(videoData, newsData) {
    try {
        const newsContext = newsData.map((n, i) => `${i+1}. [${n.title}]: ${n.snippet}`).join('\n');
        const prompt = `
        你是一位社群情報官。以下是一支剛發布的熱門影片資訊。
        請根據 [影片說明欄] 與 [網路搜尋結果]，推測這支影片的重點。

        【影片標題】：${videoData.title}
        【影片說明欄】：${videoData.description}
        【網路搜尋結果】：\n${newsContext}

        ⚠️ 請在文章開頭加註：『(影片採標題與公開資訊推測，非逐字)』
        `;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) { return "⚠️ 推測失敗"; }
}

module.exports = { 
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo, 
    searchGoogle, generateInference 
};