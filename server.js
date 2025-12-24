/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (Final Stable)
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-23   先前開發日誌請見 server_big1.js
 * 2025-12-24   Ver 1224_10   Fix: 恢復對「純文字/聊天」的反應能力。
 * Fix: 定時任務調整為 UTC 0 點 (台灣時間 08:00)。
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

// 引入新引擎 (Big 1.5)
const { searchYouTube, searchGoogle, generateAnalysis } = require('./services');

// --- 環境變數檢查 ---
const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; 
const port = process.env.PORT || 10000;
// 若 Render 沒設定 MY_CHAT_ID，不會崩潰，只是不定時匯報
const myChatId = process.env.MY_CHAT_ID; 

if (!token || !geminiKey) {
    console.error("❌ 錯誤：請確認 .env 包含 TELEGRAM_TOKEN 與 GEMINI_API_KEY");
    process.exit(1);
}

// --- 初始化服務 ---
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1224_10 - Text Chat Restored)");

// ==============================================================================
// 🧠 Big 1 模組：內容摘要邏輯
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

async function getYouTubeContent(url) {
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
    // 摘要使用預覽版模型
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n素材：${userContent}`);
    return result.response.text();
}


// ==============================================================================
// 📡 Big 1.5 模組：主動偵查
// ==============================================================================

async function runRadarTask(chatId, keyword) {
    try {
        await bot.sendMessage(chatId, `🔍 收到指令，正在偵查關於「${keyword}」的情報...`);
        const ytData = await searchYouTube(keyword);
        if (!ytData) return bot.sendMessage(chatId, `❌ 找不到關於「${keyword}」的熱門影片。`);
        
        const newsData = await searchGoogle(ytData.title);
        const report = await generateAnalysis(ytData, newsData);
        await bot.sendMessage(chatId, report);

    } catch (error) {
        console.error(`[Big 1.5 Error]`, error);
        bot.sendMessage(chatId, `⚠️ 偵查任務失敗: ${error.message}`);
    }
}

// --- ⏰ 定時任務調整 ---
// 設定為 UTC 00:00 (即台灣時間 08:00)
schedule.scheduleJob('0 0 * * *', function(){
    console.log('⏰ 啟動每日定時匯報 (TW 08:00)...');
    if (process.env.MY_CHAT_ID) {
        runRadarTask(process.env.MY_CHAT_ID, 'AI 科技趨勢'); 
    } else {
        console.log('⚠️ 未設定 MY_CHAT_ID，無法發送定時匯報');
    }
});

// --- 👤 手動指令 ---
bot.onText(/\/search (.+)/, (msg, match) => {
    runRadarTask(msg.chat.id, match[1]);
});


// ==============================================================================
// 🤖 主訊息監聽 (修正：恢復純文字回應)
// ==============================================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // 1. 如果是指令，交給 onText 處理，這裡忽略
    if (text && text.startsWith('/')) return;

    // 2. 如果沒有文字也沒有文件，忽略
    if (!text && !msg.document) return;

    bot.sendChatAction(chatId, 'typing');

    try {
        let content = "";

        // 情境 A: 網址 (YouTube 或 網頁)
        if (text && (text.startsWith('http') || text.startsWith('www'))) {
            if (text.includes('youtube') || text.includes('youtu.be')) {
                bot.sendMessage(chatId, "🎥 偵測到影片，正在讀取字幕...");
                content = await getYouTubeContent(text);
            } else {
                bot.sendMessage(chatId, "🌐 偵測到網頁，正在爬取內容...");
                content = await getWebContent(text);
            }
        } 
        // 情境 B: PDF 文件 (保留之前的邏輯)
        else if (msg.document && msg.document.mime_type === 'application/pdf') {
             bot.sendMessage(chatId, "📄 正在解析 PDF...");
             const fileLink = await bot.getFileLink(msg.document.file_id);
             const response = await axios({ url: fileLink, method: 'GET', responseType: 'arraybuffer' });
             const data = await pdf(response.data);
             content = data.text;
        }
        // 情境 C: 純文字 (修正點！之前漏了這個)
        else if (text) {
             // 直接把用戶輸入的 "你好" 或 "測試" 當作素材
             content = text;
        }

        if (content) {
            const summary = await callGeminiBig1(content);
            bot.sendMessage(chatId, summary);
        }

    } catch (error) {
        bot.sendMessage(chatId, `❌ 處理失敗: ${error.message}`);
    }
});

// Render Keep-Alive
app.get('/', (req, res) => res.send('Info Commander Ver 1224_10 Active'));
app.listen(port, () => console.log(`Server running on port ${port}`));