/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (Final Complete Version)
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-24   Ver 1224_11   Feature: 整合 Big 1.5 新引擎 (services.js)。
 * Fix: 恢復純文字聊天功能。
 * Fix: 定時任務校正為台灣時間 08:00 (UTC 00:00)。
 * Feature: /search 支援自訂天數 (例如: /search 關鍵字 3)。
 * Add: 增加詳細 Console Log 以利 Render 監控。
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
const { searchYouTube, searchGoogle, generateAnalysis } = require('./services_Backup_big15');

// --- 環境變數檢查 ---
const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; // Big 1 舊功能使用舊 Key
const port = process.env.PORT || 10000;
const myChatId = process.env.MY_CHAT_ID; // 用於定時匯報

if (!token || !geminiKey) {
    console.error("❌ 錯誤：請確認 .env 包含 TELEGRAM_TOKEN 與 GEMINI_API_KEY");
    process.exit(1);
}

// --- 初始化服務 ---
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1224_11 - Full Logic Loaded)");

// ==============================================================================
// 🧠 Big 1 模組：被動摘要 (處理使用者傳來的連結/文字/檔案)
// ==============================================================================

const SYSTEM_PROMPT = `
你是一位資深的「社群新聞編輯」，代號 Info Commander。
請將用戶提供的內容改寫為一篇「Facebook 社群深入淺出文」。

【寫作邏輯：倒金字塔新聞架構】
1. **導言**：第一段包含最重要的 5Ws。
2. **堅果段**：第二段解釋「為什麼讀者要在意？」。

【格式規範】
1. **標題**：第一行必須使用 "  ▌ " 開頭。
2. **字體**：**嚴禁使用粗體**。
3. **排版**：段落之間空一行，每段 1-3 句話。
4. **語言**：繁體中文 (Traditional Chinese)。
`;

// 1. YouTube 字幕抓取 (Web Client 模式)
async function getYouTubeContent(url) {
    try {
        const videoIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/)([^#&?]*))/);
        if (!videoIdMatch) return null;
        
        console.log(`[YouTube Web] 正在讀取影片字幕: ${videoIdMatch[1]}`);
        const youtube = await Innertube.create({
            cache: new UniversalCache(false),
            generate_session_locally: true,
            lang: 'zh-TW', location: 'TW', retrieve_player: false, client_type: 'WEB'
        });

        const info = await youtube.getInfo(videoIdMatch[1]);
        const transcriptData = await info.getTranscript();
        
        if (transcriptData?.transcript?.content?.body?.initial_segments) {
             return transcriptData.transcript.content.body.initial_segments
                .map(segment => segment.snippet.text).join(' ');
        }
        throw new Error("無字幕軌道");
    } catch (error) {
        throw new Error("YouTube 讀取失敗: " + error.message);
    }
}

// 2. 網頁爬蟲
async function getWebContent(url) {
    try {
        console.log(`[Web Crawler] 正在爬取網頁: ${url}`);
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header, .ads').remove();
        return $('body').text().trim().replace(/\s+/g, ' ').substring(0, 15000);
    } catch (e) { throw new Error("網頁讀取失敗 (可能被擋)"); }
}

// 3. Gemini 摘要 (Big 1 使用預覽版模型)
async function callGeminiBig1(userContent) {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n素材：${userContent}`);
    return result.response.text();
}


// ==============================================================================
// 📡 Big 1.5 模組：主動偵查 (定時匯報 / 手動指令)
// ==============================================================================

async function runRadarTask(chatId, keyword, days = 5) {
    try {
        console.log(`[Radar Task] 啟動偵查: "${keyword}" (範圍: ${days}天) -> ChatID: ${chatId}`);
        await bot.sendMessage(chatId, `🔍 收到指令，正在搜尋「過去 ${days} 天」關於「${keyword}」的情報...`);
        
        // 1. 找影片 (傳入天數參數)
        const ytData = await searchYouTube(keyword, days);
        if (!ytData) {
            console.log(`[Radar Task] YouTube 搜尋無結果: ${keyword}`);
            return bot.sendMessage(chatId, `❌ 過去 ${days} 天內找不到關於「${keyword}」的熱門影片。`);
        }

        // 2. 搜新聞
        const newsData = await searchGoogle(ytData.title);

        // 3. 寫報告
        const report = await generateAnalysis(ytData, newsData);

        // 4. 發送
        await bot.sendMessage(chatId, report);
        console.log(`[Radar Task] 報告發送成功 ✅`);

    } catch (error) {
        console.error(`[Radar Error]`, error);
        bot.sendMessage(chatId, `⚠️ 偵查任務失敗: ${error.message}`);
    }
}

// --- ⏰ 定時任務 (每天台灣時間 08:00 = UTC 00:00) ---
schedule.scheduleJob('0 0 * * *', function(){
    console.log('⏰ 定時任務觸發 (Daily Report)...');
    if (process.env.MY_CHAT_ID) {
        // 預設搜尋 "AI 科技趨勢"，範圍 1 天 (只看昨天的)
        runRadarTask(process.env.MY_CHAT_ID, 'AI 科技趨勢', 1); 
    } else {
        console.log('⚠️ 未設定 MY_CHAT_ID，略過定時發送。');
    }
});

// --- 👤 手動指令: /search 關鍵字 [天數] ---
bot.onText(/\/search (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim(); // 例如 "大谷翔平 3"
    
    // 智慧參數解析
    const parts = input.split(/\s+/); // 用空格切分
    let days = 5; // 預設 5 天
    let keyword = input;

    // 檢查最後一個參數是不是數字 (例如 "3")
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
        days = parseInt(parts.pop()); // 取出數字，剩下的部分重組為關鍵字
        keyword = parts.join(' ');
    }

    runRadarTask(chatId, keyword, days);
});


// ==============================================================================
// 🤖 主訊息監聽 (修正：恢復純文字回應能力)
// ==============================================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // 忽略指令 (已由 onText 處理)
    if (text && text.startsWith('/')) return;

    // 忽略非文字且非文件
    if (!text && !msg.document) return;

    console.log(`[Message] 收到來自 ${chatId} 的訊息: ${text ? text.substring(0, 15) + '...' : '[文件]'}`);
    bot.sendChatAction(chatId, 'typing');

    try {
        let content = "";

        // 情境 A: 網址
        if (text && (text.startsWith('http') || text.startsWith('www'))) {
            if (text.includes('youtube') || text.includes('youtu.be')) {
                bot.sendMessage(chatId, "🎥 偵測到影片，正在讀取字幕...");
                content = await getYouTubeContent(text);
            } else {
                bot.sendMessage(chatId, "🌐 偵測到網頁，正在爬取內容...");
                content = await getWebContent(text);
            }
        } 
        // 情境 B: PDF 文件
        else if (msg.document && msg.document.mime_type === 'application/pdf') {
             bot.sendMessage(chatId, "📄 收到 PDF，正在解析...");
             const fileLink = await bot.getFileLink(msg.document.file_id);
             const response = await axios({ url: fileLink, method: 'GET', responseType: 'arraybuffer' });
             const data = await pdf(response.data);
             content = data.text;
        }
        // 情境 C: 純文字聊天 (修正點 ✅)
        else if (text) {
             // 將用戶的閒聊或文字段落直接當作素材
             content = text;
        }

        if (content) {
            const summary = await callGeminiBig1(content);
            bot.sendMessage(chatId, summary);
        }

    } catch (error) {
        console.error(`[Handler Error]`, error.message);
        bot.sendMessage(chatId, `❌ 處理失敗: ${error.message}`);
    }
});

// Render Keep-Alive & Health Check
app.get('/', (req, res) => res.send('Info Commander Ver 1224_11 Active (Big 1.5 + Chat Fix)'));
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});