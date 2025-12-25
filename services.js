/**
 * ==============================================================================
 * 🛠️ Info Commander Service Module (Big 2  Ver 1225_16 Edition)
 * ==============================================================================
 * [Status]
 * 1. Optimized for Big 2 Server (Key alignment)
 * 2. Removed deprecated functions (Old XML Trends, Old Analysis)
 * 3. Preserved YouTube Data API v3 Wrappers
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 初始化 (已校準變數名稱) ---
// 統一使用 GOOGLE_SEARCH_KEY (若 .env 沒改好，自動降級抓舊變數)
const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });

// 統一使用 GEMINI_API_KEY
const geminiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // 升級模型與 Server 一致

// 📅 工具：計算時間
function getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
}

// ==========================================
// A. YouTube 核心功能 (API Only)
// ==========================================

// A-1. 關鍵字搜尋 (手動/每日議題用)
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

// A-2. 取得地區熱門影片 (05:00 晨報用)
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

// A-3. 檢查頻道最新影片 (05:10 監控用)
async function checkChannelLatestVideo(channelId) {
    try {
        // 1. 找該頻道過去 24 小時內的最新影片 (最多 3 支)
        const res = await youtube.search.list({
            part: 'snippet', channelId: channelId, order: 'date', type: 'video',
            publishedAfter: getDateDaysAgo(1), maxResults: 3 
        });

        if (!res.data.items || res.data.items.length === 0) return []; 

        const videos = [];
        for (const video of res.data.items) {
            // 必須額外呼叫 videos.list 才能拿到完整的 description
            const detailRes = await youtube.videos.list({
                part: 'snippet', id: video.id.videoId
            });
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
                key: googleKey, // 使用校準後的 Key
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
// C. Gemini 輔助推測 (僅保留推測功能)
// ==========================================

// C-1. 推測分析 (含警語) - 用於頻道監控
async function generateInference(videoData, newsData) {
    try {
        const newsContext = newsData.map((n, i) => `${i+1}. [${n.title}]: ${n.snippet}`).join('\n');
        const prompt = `
        你是一位社群情報官。以下是一支剛發布的熱門影片資訊。
        由於版權與技術限制，我們無法讀取字幕，請你根據 [影片說明欄] 與 [網路搜尋結果]，
        為我推測並整理這支影片可能在講什麼。

        【影片標題】：${videoData.title}
        【影片說明欄】：${videoData.description}
        【網路搜尋結果】：\n${newsContext}

        ⚠️ 請在文章開頭加註：『(影片採標題與公開資訊推測，非逐字)』
        `;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) { return "⚠️ 推測失敗"; }
}

// 匯出模組 (只匯出 Server 真正需要的)
module.exports = { 
    searchYouTube, 
    getMostPopularVideos, 
    checkChannelLatestVideo, 
    searchGoogle, 
    generateInference
};