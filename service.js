/**
 * ==============================================================================
 * 🛠️ Info Commander Service Module (Final Release)
 * ==============================================================================
 * [Features]
 * 1. Search: YouTube (API) + Google News
 * 2. Monitor: Channel Latest (Returns Array of up to 3 videos)
 * 3. Trends: Google Trends RSS Parsing
 * 4. Brain: Gemini Inference Mode (Video Desc + Title)
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const xml2js = require('xml2js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 初始化 ---
const youtube = google.youtube({ version: 'v3', auth: process.env.GOOGLE_CLOUD_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_NEW);
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

// A-3. 檢查頻道最新影片 (05:10 監控用) - ✅ 已更新為回傳陣列
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
// B. Google Trends RSS (06:00 全球熱搜用)
// ==========================================
async function getGoogleTrends(geo) {
    try {
        const rssUrl = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`;
        const { data } = await axios.get(rssUrl);
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(data);
        const items = result.rss.channel[0].item.slice(0, 3);
        return items.map(item => ({
            title: item.title[0],
            traffic: item['ht:approx_traffic'] ? item['ht:approx_traffic'][0] : 'N/A'
        }));
    } catch (error) {
        console.error(`[Trends Error] Geo: ${geo}`, error.message);
        return [];
    }
}

// ==========================================
// C. Google Search (輔助偵查)
// ==========================================
async function searchGoogle(query) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
            params: { key: process.env.GOOGLE_CLOUD_API_KEY, cx: process.env.SEARCH_ENGINE_ID, q: query, num: 3 }
        });
        if (!res.data.items) return [];
        return res.data.items.map(item => ({ title: item.title, snippet: item.snippet }));
    } catch (error) { return []; }
}

// ==========================================
// D. Gemini 大腦 (分析與推測)
// ==========================================

// D-1. 標準分析
async function generateAnalysis(videoData, newsData) {
    try {
        const newsContext = newsData.map((n, i) => `${i+1}. [${n.title}]: ${n.snippet}`).join('\n');
        const prompt = `
        你是一位社群情報官。請根據以下素材寫一篇「社群情報快訊」。
        【YouTube 資訊】標題：${videoData.title}\n頻道：${videoData.channel}
        【網路搜查】\n${newsContext}
        【任務】
        1. 標題：用 " ▌ " 開頭。
        2. 摘要：100字內總結。
        3. 補充：結合網路搜查結果。
        `;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) { return "⚠️ 分析失敗"; }
}

// D-2. 推測分析 (含警語)
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

// E. Phase 2 圖片介面 (預留)
async function searchImage(keyword) { return null; }

module.exports = { 
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo, 
    getGoogleTrends, searchGoogle, 
    generateAnalysis, generateInference, searchImage 
};