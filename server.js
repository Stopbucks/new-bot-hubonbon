/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (War Room Big 2 Edition)
 * ==============================================================================
 * [Development Log]
 * 2025-12-24 | Ver 1224_15 | Final Release: 確立 Big 2 基礎架構 (RSS + Router).
 * 2025-12-25 | Ver 1225_16 | Critical Fix: 升級 Google AI SDK 以解決 404 錯誤.
 * 2025-12-25 | Ver 1225_17 | Model Upgrade: 全面切換至 Gemini 3 Flash Preview.
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const RSSParser = require('rss-parser');

// 引入服務模組
const { 
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo,
    searchGoogle, 
    generateInference 
} = require('./services');

const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; 
const port = process.env.PORT || 10000;

if (!token || !geminiKey) { console.error("❌ 缺漏環境變數"); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();
const parser = new RSSParser();

console.log("🚀 System Starting... (Big 2 Ver 1225_17 - Gemini 3 Edition)");

// --- 工具：延遲函式 ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 🧠 Big 2 核心：新一代智能函數
// ==========================================

// 1. 雙軌搜圖路由 (Smart Image Router)
async function fetchSmartImage(keyword, type) {
    try {
        let imageUrl = '';
        console.log(`[Image Router] 請求: ${keyword} (Type: ${type})`);

        // 路線 A: Concept -> Unsplash
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
            const res = await axios.get(unsplashUrl);
            if (res.data.results && res.data.results.length > 0) {
                imageUrl = res.data.results[0].urls.regular;
                console.log(`[Image] Unsplash 命中`);
            }
        }
        
        // 路線 B: News 或 Unsplash 失敗 -> Google Image
        if (!imageUrl) {
            const googleUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${process.env.GOOGLE_SEARCH_KEY}&searchType=image&num=1`;
            const res = await axios.get(googleUrl);
            if (res.data.items && res.data.items.length > 0) {
                imageUrl = res.data.items[0].link;
                console.log(`[Image] Google Image 命中`);
            }
        }
        
        return imageUrl;
    } catch (e) {
        console.error(`[Image Error] ${e.message}`);
        return null;
    }
}

// 2. Gemini 分析 V2 (輸出 JSON 決策) - ✅ 升級為 Gemini 3
async function generateAnalysisV2(ytData, newsData) {
    // 這裡指定使用 Gemini 3 Flash Preview
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    
    const prompt = `
    你是一個全球情報分析師。請針對以下素材進行分析：
    【YouTube 標題】：${ytData.title}
    【相關新聞】：${newsData}

    請輸出一個 **純 JSON 格式** 的回應 (不要 Markdown，不要解釋)，包含兩個欄位：
    1. "content": 一篇繁體中文社群貼文。格式要求：
       - 標題以 "  ▌ " 開頭。
       - 倒金字塔風格 (重點在前)。
       - 段落間空一行。
       - 語氣專業但易讀 (Facebook 風格)。
       - 300字以內。
       - 最後一段列出參考來源。
    
    2. "image_decision": 一個物件，包含：
       - "type": 若內容為具體新聞事件請填 "news"，若為抽象趨勢/教學/概念請填 "concept"。
       - "keyword": 搜尋圖片用的英文關鍵字 (news 用具體名詞，concept 用意境詞)。
    `;

    try {
        const result = await model.generateContent(prompt);
        let responseText = result.response.text();
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(responseText);
    } catch (e) {
        console.error("Gemini JSON 解析失敗或 API 錯誤:", e.message);
        return {
            content: `  ▌ 分析報告 (Fallback)\n\n${ytData.title}\n\n系統暫時無法生成完整分析。`,
            image_decision: { type: "news", keyword: ytData.title }
        };
    }
}

// 3. 自動分發 (Make Integration)
async function dispatchToSocial(payload) {
    if (!process.env.MAKE_WEBHOOK_URL) return;
    try {
        await axios.post(process.env.MAKE_WEBHOOK_URL, payload);
        console.log(`[Make] Webhook 發送成功`);
    } catch (e) {
        console.error(`[Make Error] ${e.message}`);
    }
}

// ==========================================
// ⏰ 定時任務區
// ==========================================

// 任務 1A: 05:00 娛樂熱門榜
schedule.scheduleJob('0 21 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [05:00 Job] 啟動 YouTube 熱門榜...');
    try {
        const regions = ['TW', 'US', 'JP'];
        let popularReport = "🔥 **昨日 YouTube 發燒影片 (Top 3)**\n";
        for (const region of regions) {
            const videos = await getMostPopularVideos(region);
            popularReport += `\n**[${region}]**\n`;
            videos.forEach((v, i) => popularReport += `${i+1}. [${v.title}](${v.url})\n`);
        }
        await bot.sendMessage(chatId, popularReport, { parse_mode: 'Markdown' });
    } catch (e) { console.error("熱門榜錯誤:", e.message); }
});

// 任務 1B: 05:10 頻道監控 (序列化緩衝)
schedule.scheduleJob('10 21 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    const channels = process.env.MONITOR_CHANNELS ? process.env.MONITOR_CHANNELS.split(',') : [];
    if (channels.length === 0) return;

    console.log(`⏰ [05:10 Job] 啟動頻道監控 (${channels.length} 位)...`);
    for (let i = 0; i < channels.length; i++) {
        const channelId = channels[i].trim();
        if (!channelId) continue;
        try {
            const newVideos = await checkChannelLatestVideo(channelId);
            if (newVideos && newVideos.length > 0) {
                console.log(`[Monitor] ${channelId} 發現 ${newVideos.length} 新片`);
                for (const video of newVideos) {
                    const news = await searchGoogle(video.title);
                    const inference = await generateInference(video, news); 
                    await bot.sendMessage(chatId, `🚨 **大神發片**\n${inference}\n📺 ${video.url}`);
                    if (newVideos.length > 1) await delay(60000); 
                }
            }
        } catch (err) { console.error(`[Monitor Error] ${channelId}:`, err.message); }
        if (i < channels.length - 1) { 
            console.log(`[Buffer] 休息 3 分鐘...`);
            await delay(180000); 
        }
    }
    console.log(`✅ [05:10 Job] 監控結束`);
});

// 任務 2: 06:00 全球熱搜 (RSS Mode)
schedule.scheduleJob('0 22 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [06:00 Job] 啟動全球熱搜 (RSS Mode)...');

    const targets = [{ geo: 'US', flag: '🇺🇸', name: '美國' }, { geo: 'GB', flag: '🇬🇧', name: '英國' }, { geo: 'JP', flag: '🇯🇵', name: '日本' }];
    let trendReport = "🌎 **昨夜今晨全球 Google 熱搜**\n(點擊指令可深入偵查)\n";

    try {
        for (const t of targets) {
            const rssUrl = `