/**
 * ==============================================================================
 * 🛠️ Info Commander Services
 * ==============================================================================
 * [Version]     1227_Update_Slot1_2_RSS_Final
 * [Feature]     Two-Stage Video Fetch / Sequential RSS / Standard Mode
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse');
const Parser = require('rss-parser');

// ✅ 設定：使用標準連線 (無偽裝表頭)，設定 10 秒超時保護
const parser = new Parser({
    timeout: 10000 
});

const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ 模型設定
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const getDateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// 🔍 A. 圖片搜尋 (維持原樣)
// ============================================================================
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

// ============================================================================
// 📖 B. 閱讀能力 PDF & Web (維持原樣)
// ============================================================================
async function processUrl(url) { 
    try {
        console.log(`[Service] Reading: ${url}`);
        const res = await axios.get(url, { timeout: 10000 });
        const rawHtml = res.data.substring(0, 40000); 
        const result = await model.generateContent(`請忽略HTML標籤，摘要這篇網頁文章(繁體中文)，若是新聞請抓出重點：\n${rawHtml}`);
        return result.response.text();
    } catch (e) { return "⚠️ 無法讀取網頁 (可能被阻擋或連線逾時)。"; }
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

// ============================================================================
// ✍️ C. Gate 改寫 (維持原樣)
// ============================================================================
async function processGateMessage(rawText) {
    try {
        const result = await model.generateContent(`
        改寫為 FB 貼文 (純JSON):
        {"content": "含標題(  ▌  ), Emoji, Hashtag, 150字內, 語氣吸睛", "image_decision": {"type":"news/concept", "keyword":"en_keyword"}}
        \n內容: ${rawText}`);
        let jsonStr = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(jsonStr);
        const img = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);
        return { content: json.content, imageUrl: img };
    } catch (e) { return { content: "⚠️ AI 生成失敗，請重試", imageUrl: "" }; }
}

// ============================================================================
// 🧠 D. 自動化分析 (時段三 - 待後續修改，目前維持原樣)
// ============================================================================
async function generateAnalysisV2(ytData, newsData) {
    try {
        const result = await model.generateContent(`
        你是一個全球情報分析師。請針對以下素材進行分析：
        【YouTube 標題】：${ytData.title}
        【相關新聞】：${newsData}

        請輸出一個 **純 JSON 格式** 的回應 (不要 Markdown，不要解釋)，包含以下兩個欄位：
        1. "content": 一篇繁體中文社群貼文。格式要求：
           - 標題以 "  ▌ " 開頭。
           - 倒金字塔風格 (重點在前)。
           - 段落間空一行。
           - 語氣專業但易讀 (Facebook 風格)。
           - 300字以內。
           - 最後一段列出參考來源。
        2. "image_decision": {"type":"news", "keyword":"${ytData.title} (keywords in English)"}
        `);
        return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (e) { 
        console.log("[Analysis Error]", e.message);
        return null;
    }
}

// ============================================================================
// 🤖 E. 自動化爬蟲 (時段一 & 二 核心更新區)
// ============================================================================

// [時段一] 熱門影片 (支援多國代碼)
async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ 
            part: 'snippet', 
            chart: 'mostPopular', 
            regionCode: regionCode, 
            maxResults: 5 
        });
        return res.data.items.map(v => ({ 
            title: v.snippet.title, 
            url: `https://www.youtube.com/watch?v=${v.id}` 
        }));
    } catch (e) { 
        console.log(`[Youtube Error] Pop Video (${regionCode}): ${e.message}`);
        return []; 
    }
}

// [時段二] 大神發片 (🔥 更新：兩段式取資料 + 容錯)
async function checkChannelLatestVideo(channelId) {
    try {
        // Step 1: 偵察 (Search) - 確認 24 小時內有無新片
        const searchRes = await youtube.search.list({ 
            part: 'snippet', 
            channelId: channelId, 
            order: 'date', 
            type: 'video', 
            publishedAfter: getDateDaysAgo(1), 
            maxResults: 1 
        });

        const videoItem = searchRes.data.items?.[0];
        if (!videoItem) return null; // 沒新片，安靜離開

        // ⏳ 微暫停 1 秒 (緩衝 API)
        await delay(1000);

        // Step 2: 挖掘 (Details) - 取得詳細資料 (說明欄、頻道全名)
        const videoId = videoItem.id.videoId;
        const detailRes = await youtube.videos.list({
            part: 'snippet,contentDetails',
            id: videoId
        });

        const detail = detailRes.data.items?.[0]?.snippet;
        if (!detail) return null; 

        // Step 3: 資料清洗 (說明欄容錯判斷)
        const fullDesc = detail.description || "";
        let finalDesc = "";

        // 若說明欄夠豐富 (>50字)，才視為有效內容
        if (fullDesc.length > 50) {
            // 這裡未來可擴充：抓時間軸、抓 Tag 等
            finalDesc = fullDesc; 
        }

        return {
            title: detail.title,
            channelTitle: detail.channelTitle, // 正確的頻道名稱
            url: `https://www.youtube.com/watch?v=${videoId}`,
            description: finalDesc,
            publishedAt: detail.publishedAt
        };

    } catch (e) { 
        console.log(`[Youtube Error] Channel Monitor: ${e.message}`);
        return null; 
    }
}

// 輔助搜尋 (給時段三用)
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

// 時段四：Google 熱搜 (Server 不呼叫，保留給 Dashboard 測試)
async function getGlobalTrends(geo) {
    try {
        const res = await axios.get(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, { timeout: 5000 });
        const matches = [...res.data.matchAll(/<title>(.*?)<\/title>/g)];
        return matches.slice(1, 11).map(m => ({ title: m[1].replace(/<!\[CDATA\[|\]\]>/g, '') }));
    } catch (e) { return []; }
}

async function dispatchToMake(payload) {
    if (process.env.MAKE_WEBHOOK_URL) await axios.post(process.env.MAKE_WEBHOOK_URL, payload).catch(e=>{});
}

// ============================================================================
// 📡 F. RSS 讀取 (Dashboard 用 - 🔥 更新：序列呼吸機制)
// ============================================================================
async function fetchRSS(feedUrl, sourceName) {
    try {
        const feed = await parser.parseURL(feedUrl);
        // ✅ 只抓前 5 筆，輕量化，不需要 content
        return feed.items.slice(0, 5).map(item => ({
            title: `[${sourceName}] ${item.title}`,
            link: item.link,
            pubDate: item.pubDate
        }));
    } catch (e) {
        console.log(`[RSS Warning] ${sourceName} read failed: ${e.message}`);
        return [{ title: `⚠️ [${sourceName}] 讀取失敗`, link: '#', pubDate: new Date().toISOString() }];
    }
}

async function fetchAllRSS(rssList) {
    let allItems = [];
    
    // 🔄 改為「序列執行」：一個接一個抓，避免瞬間流量衝擊
    for (const rss of rssList) {
        const items = await fetchRSS(rss.url, rss.name);
        allItems = allItems.concat(items);
        
        // ⏳ 呼吸時間：每個來源之間間隔 1.5 秒 (輕量化原則)
        await delay(1500);
    }
    
    return allItems; 
}

module.exports = {
    processGateMessage, processPDF, processUrl, generateAnalysisV2,
    searchYouTube, searchGoogle, getGlobalTrends, getMostPopularVideos, checkChannelLatestVideo,
    fetchSmartImage, dispatchToMake,
    fetchRSS, fetchAllRSS
};