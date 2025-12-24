/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (Integrated Version)
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-23   Ver 1223_05   Target Fix: 針對學生專案，鎖定模型為 gemini-3-flash-preview。
 * 2025-12-23   Ver 1223_06   Critical Fix: 更換為 youtubei.js 引擎。
 * 2025-12-23   Ver 1223_07   Critical Fix: YouTube Client 切換為 WEB 模式，解決 400/ParsingError。
 * 2025-12-24   Ver 1224_09   Merge: 整合 Big 1 (被動摘要) + Big 1.5 (主動偵查)。
 * Add: node-schedule 定時任務 & /search 指令。
 * ==============================================================================
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Innertube, UniversalCache } = require('youtubei.js');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');

// 引入我們剛測試成功的新引擎 (Big 1.5)
const { searchYouTube, searchGoogle, generateAnalysis } = require('./services');

// --- 環境變數檢查 ---
const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; // Big 1 用舊 Key
const port = process.env.PORT || 10000;
const myChatId = process.env.MY_CHAT_ID; // 您的 Telegram ID (用於定時發送)

if (!token || !geminiKey) {
    console.error("❌ 錯誤：請確認 .env 包含 TELEGRAM_TOKEN 與 GEMINI_API_KEY");
    process.exit(1);
}

// --- 初始化服務 ---
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1224_09 - Full Integrated Mode)");

// ==============================================================================
// 🧠 Big 1 模組：被動摘要 (處理使用者傳來的連結/文字/檔案)
// ==============================================================================

const SYSTEM_PROMPT = `
你是一位資深的「社群新聞編輯」，代號 Info Commander。
請將用戶提供的內容改寫為一篇「Facebook 社群深入淺出文」。
【格式規範】
1. 標題：第一行必須使用 "  ▌ " 開頭。
2. 字體：嚴禁使用粗體。
3. 排版：段落間空一行，每段 1-3 句話。
4. 語言：繁體中文 (Traditional Chinese)。
`;

// ... (保留原本 Big 1 的 helper functions: getYouTubeContent, getWebContent, callGemini) ...
// 為了版面整潔，這裡沿用您原本的邏輯，稍微精簡展示

async function getYouTubeContent(url) {
    // ... (維持您原本 Ver 1223_07 的程式碼) ...
    try {
        const videoIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/)([^#&?]*))/);
        if (!videoIdMatch) return null;
        const youtube = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locally: true,
            lang: 'zh-TW', location: 'TW', retrieve_player: false, client_type: 'WEB'
        });
        const info = await youtube.getInfo(videoIdMatch[1]);
        const transcriptData = await info.getTranscript();
        if (transcriptData?.transcript?.content?.body?.initial_segments) {
             return transcriptData.transcript.content.body.initial_segments.map(s => s.snippet.text).join(' ');
        }
        throw new Error("無字幕");
    } catch (error) { throw new Error("YouTube 讀取失敗: " + error.message); }
}

async function getWebContent(url) {
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        $('script, style, nav, footer').remove();
        return $('body').text().trim().replace(/\s+/g, ' ').substring(0, 15000);
    } catch (e) { throw new Error("網頁讀取失敗"); }
}

async function callGeminiBig1(userContent) {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n素材：${userContent}`);
    return result.response.text();
}


// ==============================================================================
// 📡 Big 1.5 模組：主動偵查 (定時匯報 / 手動指令)
// ==============================================================================

// 共用核心流程：找影片 -> 搜新聞 -> 寫報告
async function runRadarTask(chatId, keyword) {
    try {
        await bot.sendMessage(chatId, `🔍 收到指令，正在偵查關於「${keyword}」的情報...`);
        
        // 1. 找影片
        const ytData = await searchYouTube(keyword);
        if (!ytData) {
            return bot.sendMessage(chatId, `❌ 找不到關於「${keyword}」的熱門影片。`);
        }

        // 2. 搜新聞 (補充情報)
        const newsData = await searchGoogle(ytData.title);

        // 3. 寫報告
        const report = await generateAnalysis(ytData, newsData);

        // 4. 發送結果
        await bot.sendMessage(chatId, report);
        console.log(`[Big 1.5] 任務完成: ${keyword}`);

    } catch (error) {
        console.error(`[Big 1.5 Error]`, error);
        bot.sendMessage(chatId, `⚠️ 偵查任務失敗: ${error.message}`);
    }
}

// --- ⏰ 定時任務 (每天早上 08:00) ---
schedule.scheduleJob('0 8 * * *', function(){
    console.log('⏰ 啟動每日定時匯報...');
    // 如果您還沒設定 MY_CHAT_ID，建議先用手動指令觸發，或在 .env 新增 MY_CHAT_ID
    if (process.env.MY_CHAT_ID) {
        runRadarTask(process.env.MY_CHAT_ID, 'AI 科技趨勢'); // 您可以改預設關鍵字
    }
});

// --- 👤 手動指令 (/search 關鍵字) ---
bot.onText(/\/search (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const keyword = match[1]; // 抓取指令後面的字
    runRadarTask(chatId, keyword);
});


// ==============================================================================
// 🤖 主訊息監聽 (Big 1 邏輯保持不變)
// ==============================================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // 忽略指令 (以 / 開頭的訊息交給 onText 處理)
    if (text && text.startsWith('/')) return;

    if (!text && !msg.document) return;

    // 簡單判斷：這是網址嗎？
    if (text && (text.startsWith('http') || text.startsWith('www'))) {
        bot.sendChatAction(chatId, 'typing');
        try {
            let content = "";
            if (text.includes('youtube') || text.includes('youtu.be')) {
                bot.sendMessage(chatId, "🎥 正在讀取影片字幕...");
                content = await getYouTubeContent(text);
            } else {
                bot.sendMessage(chatId, "🌐 正在讀取網頁...");
                content = await getWebContent(text);
            }
            const summary = await callGeminiBig1(content);
            bot.sendMessage(chatId, summary);
        } catch (error) {
            bot.sendMessage(chatId, `❌ 處理失敗: ${error.message}`);
        }
    }
    // 處理 PDF 邏輯可在此處保留...
});

// Render Keep-Alive
app.get('/', (req, res) => res.send('Info Commander Ver 1224_09 Active'));
app.listen(port, () => console.log(`Server running on port ${port}`));