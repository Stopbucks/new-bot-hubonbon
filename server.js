/**
 * ==============================================================================
 * 🛠️ Info Commander Development Log
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-23   Ver 1223_05   Target Fix: 針對學生專案，鎖定模型為 gemini-3-flash-preview。
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { YoutubeTranscript } = require('youtube-transcript');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');

// --- 環境變數檢查 ---
const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
const port = process.env.PORT || 10000;

if (!token || !geminiKey) {
    console.error("❌ 錯誤：請確認 .env 或 Render 環境變數中包含 TELEGRAM_TOKEN 與 GEMINI_API_KEY");
    process.exit(1);
}

// --- 初始化服務 ---
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1223_05 - Gemini 3 Flash Preview)");

// --- 核心：System Prompt ---
const SYSTEM_PROMPT = `
你是一位資深的「社群新聞編輯」，代號 Info Commander。
請將用戶提供的內容（影片字幕、文章、文件）改寫為一篇「Facebook 社群深入淺出文」。

【寫作邏輯：倒金字塔新聞架構】
1. **導言 (The Lead)**：第一段 (1-2句) 必須包含最重要的 5Ws (Who, What, When, Where, Why)。
2. **堅果段 (Nut Graf)**：第二段解釋「為什麼讀者要在意？」，建立與讀者的利益共鳴。
3. **內文排序**：後續細節按「重要性」排序，而非時間順序。

【格式規範 - 嚴格執行】
1. **標題**：第一行必須使用 "  ▌ " 開頭 (例如：  ▌ 標題內容)。風格需具吸引力或反差感。
2. **字體**：**嚴禁使用粗體** (不要使用 Markdown ** bold)。
3. **排版**：
   - 段落之間必須空一行。
   - 每段控制在 1-3 句話，保持閱讀節奏輕快。
   - 適度使用 Emoji 進行視覺分隔。
4. **引用**：所有參考來源連結，統一整理在文章最後一段。
5. **語言**：無論輸入語言為何，輸出結果一律為「繁體中文 (Traditional Chinese)」。

【互動修改 (Editing Loop)】
- 若用戶提供了「修改指令」(例如：改標題、縮短字數)，請保留原文章架構，僅根據指令進行修正。
`;

// --- 工具函數 ---

// 1. 抓取 YouTube 字幕
async function getYouTubeContent(url) {
    try {
        const videoIdMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:.*v=|.*\/)([^#&?]*))/);
        if (!videoIdMatch) return null;
        const videoId = videoIdMatch[1];
        
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'zh-TW' })
            .catch(() => YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }))
            .catch(() => YoutubeTranscript.fetchTranscript(videoId));

        return transcriptItems.map(item => item.text).join(' ');
    } catch (error) {
        throw new Error("無法讀取影片字幕 (可能未開啟字幕功能或不支援)");
    }
}

// 2. 爬取網頁文章
async function getWebContent(url) {
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header, .ads, .advertisement').remove();
        let content = $('article').text().trim() || $('body').text().trim();
        return content.replace(/\s+/g, ' ').substring(0, 15000);
    } catch (error) {
        throw new Error("無法讀取網頁內容 (可能網站有阻擋爬蟲)");
    }
}

// 3. Gemini 生成邏輯 (Ver 1223_05: 使用 gemini-3-flash-preview)
async function callGemini(userContent, isRevision = false, revisionInstruction = "") {
    // ✅ 關鍵修正：針對您的學生專案，指定使用 gemini-3-flash-preview
    // 這是根據您 AI Studio 截圖右側欄位顯示的名稱設定的
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    let finalPrompt = "";
    if (isRevision) {
        finalPrompt = `
        ${SYSTEM_PROMPT}
        
        【任務：修改文章】
        原始文章內容：
        ${userContent}
        
        用戶的修改指令：
        ${revisionInstruction}
        
        請根據修改指令重寫文章，並嚴格遵守上述格式規範。
        `;
    } else {
        finalPrompt = `
        ${SYSTEM_PROMPT}
        
        【任務：撰寫新文章】
        請閱讀以下素材內容，並撰寫貼文：
        ${userContent}
        `;
    }

    const result = await model.generateContent(finalPrompt);
    return result.response.text();
}

// --- 機器人事件監聽 ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text && !msg.document) return;

    bot.sendChatAction(chatId, 'typing');

    try {
        let inputData = "";
        let isRevision = false;
        let revisionInstruction = "";

        // Revision Logic
        if (msg.reply_to_message && msg.reply_to_message.from.id === bot.id) {
            console.log(`[Revision] 用戶要求修改文章`);
            inputData = msg.reply_to_message.text;
            isRevision = true;
            revisionInstruction = text;
        } 
        // YouTube & Web
        else if (text && (text.startsWith('http') || text.startsWith('www'))) {
            if (text.includes('youtube.com') || text.includes('youtu.be')) {
                bot.sendMessage(chatId, "🎥 偵測到影片，正在讀取字幕並進行內容煉金... (Ver 1223_05)");
                inputData = await getYouTubeContent(text);
            } else {
                bot.sendMessage(chatId, "🌐 偵測到連結，正在爬取網頁並進行內容煉金... (Ver 1223_05)");
                inputData = await getWebContent(text);
            }
        }
        // PDF
        else if (msg.document) {
            const mime = msg.document.mime_type;
            if (mime === 'application/pdf' || mime === 'text/plain') {
                bot.sendMessage(chatId, "📄 收到文件，正在解析內容...");
                const fileLink = await bot.getFileLink(msg.document.file_id);
                const response = await axios({ url: fileLink, method: 'GET', responseType: 'arraybuffer' });
                if (mime === 'application/pdf') {
                    const data = await pdf(response.data);
                    inputData = data.text;
                } else {
                    inputData = response.data.toString('utf-8');
                }
            } else {
                return bot.sendMessage(chatId, "⚠️ 目前僅支援 PDF 與 TXT 文件格式。");
            }
        }
        else if (!isRevision) {
             inputData = text;
        }

        if (!inputData) return bot.sendMessage(chatId, "❌ 無法提取內容。");

        const responseText = await callGemini(inputData, isRevision, revisionInstruction);
        await bot.sendMessage(chatId, responseText);
        console.log(`[Success] 回應已發送 (ChatID: ${chatId})`);

    } catch (error) {
        console.error("處理錯誤:", error);
        let errorMsg = error.message;
        // 錯誤訊息優化
        if (errorMsg.includes('404')) errorMsg = "權限錯誤 (404) - 您的帳號似乎不支援此模型";
        if (errorMsg.includes('409')) errorMsg = "系統忙碌中 (Conflict)";
        bot.sendMessage(chatId, `⚠️ 發生錯誤：${errorMsg}`);
    }
});

// Render Health Check
app.get('/', (req, res) => {
    res.send('Info Commander is Running (Ver 1223_05 Gemini 3)');
});
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});