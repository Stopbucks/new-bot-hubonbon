/**
 * ==============================================================================
 * 🛠️ Info Commander Development Log
 * ==============================================================================
 * [Date]       [Version]     [Changes]
 * 2025-12-29   Ver 1229_03   Update: 修正 Prompt (通用社群文)，保留審核模式與強健發送。
 * ==============================================================================
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1229_03 - Bridge Mode)");

// ✅ 修改後的 Prompt：移除特定平台限制，適用於通用社群
const SYSTEM_PROMPT = `
你是一位資深的「社群新聞編輯」，代號 Info Commander。
請將用戶提供的內容（影片字幕、文章、文件）改寫為一篇「社群深入淺出文」。

【寫作邏輯：倒金字塔新聞架構】
1. **導言 (The Lead)**：第一段 (1-2句) 必須包含最重要的 5Ws (Who, What, When, Where, Why)。
2. **堅果段 (Nut Graf)**：第二段解釋「為什麼讀者要在意？」，建立與讀者的利益共鳴。
3. **內文排序**：後續細節按「重要性」排序，而非時間順序。

【格式規範 - 嚴格執行】
1. **標題**：第一行必須使用 "  ▌ " 開頭 (例如：  ▌ 標題內容)。風格需具吸引力或反差感。
2. **字體**：**嚴禁使用粗體** (不要使用 Markdown ** bold)，以免影響發送格式。
3. **字數限制**：整篇文章請嚴格控制在 **1000 個中文字以內**。
4. **排版**：
   - 段落之間必須空一行。
   - 每段控制在 1-3 句話，保持閱讀節奏輕快。
   - 適度使用 Emoji 進行視覺分隔。
5. **引用**：所有參考來源連結，統一整理在文章最後一段。
6. **語言**：無論輸入語言為何，輸出結果一律為「繁體中文 (Traditional Chinese)」。

【互動修改 (Editing Loop)】
- 若用戶提供了「修改指令」(例如：改標題、縮短字數)，請保留原文章架構，僅根據指令進行修正。
`;

// --- 工具函數 ---

// 1. ✅ 強健發送函數 (防止崩潰 + 自動切分 + 格式容錯)
async function sendRobustMessage(chatId, text) {
    const MAX_LENGTH = 4000; // 保留緩衝區 (Telegram 上限 4096)
    
    // A. 切分訊息 (如果太長)
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_LENGTH) {
        chunks.push(text.substring(i, i + MAX_LENGTH));
    }

    // B. 逐段發送
    for (const chunk of chunks) {
        try {
            // 優先嘗試：使用 Markdown 發送 (為了排版漂亮)
            await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
        } catch (error) {
            console.warn(`[Send Warning] Markdown 發送失敗，轉為純文字重試: ${error.message}`);
            try {
                // 備用方案：如果 Markdown 報錯 (例如符號未閉合)，改用純文字再送一次
                await bot.sendMessage(chatId, chunk); 
            } catch (fatalError) {
                console.error(`[Send Failed] 純文字發送也失敗，放棄此段落: ${fatalError.message}`);
            }
        }
        // 稍微休息一下，避免連續發送被 Telegram 擋
        await new Promise(r => setTimeout(r, 300));
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

// 3. Gemini 生成邏輯
async function callGemini(userContent, isRevision = false, revisionInstruction = "") {
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
    
    // 為了 UX，送出 typing 狀態 (但加上 catch 避免非致命錯誤)
    bot.sendChatAction(chatId, 'typing').catch(() => {});

    try {
        let inputData = "";
        let isRevision = false;
        let revisionInstruction = "";

        // 1. 判斷是否為「修改指令」 (Reply 模式)
        if (msg.reply_to_message && msg.reply_to_message.from.id === bot.id) {
            console.log(`[Revision] 用戶要求修改文章`);
            inputData = msg.reply_to_message.text;
            isRevision = true;
            revisionInstruction = text;
        } 
        // 2. 判斷是否為「連結」 (HTTP / WWW)
        else if (text && (text.startsWith('http') || text.startsWith('www'))) {
            // ✅ 不管是否為 YouTube，一律當作網頁爬取 (移除 youtubei.js 依賴)
            bot.sendMessage(chatId, "🌐 偵測到連結，正在爬取網頁...");
            inputData = await getWebContent(text);
        }
        // 3. 判斷是否為「文件」 (PDF / TXT)
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
        // 4. 純文字輸入
        else if (!isRevision) {
             inputData = text;
        }

        if (!inputData) return bot.sendMessage(chatId, "❌ 無法提取內容。");

        // 呼叫 Gemini
        const responseText = await callGemini(inputData, isRevision, revisionInstruction);
        
        // ✅ 使用強健發送函式 (避免崩潰)
        await sendRobustMessage(chatId, responseText);
        console.log(`[Success] 回應已發送 (ChatID: ${chatId})`);

    } catch (error) {
        console.error("處理錯誤:", error);
        let errorMsg = error.message;
        if (errorMsg.includes('404')) errorMsg = "權限錯誤 (404) - 您的帳號似乎不支援此模型";
        if (errorMsg.includes('409')) errorMsg = "系統忙碌中 (Conflict) - 請稍後再試";
        
        // 這裡也要 catch 住，防止死鎖
        bot.sendMessage(chatId, `⚠️ 發生錯誤：${errorMsg}`).catch(() => {});
    }
});

// ==========================================
// 🧪 GitHub Action 測試專用窗口 (Test Route) - 審核模式 (Bridge-room)
// ==========================================
const services = require('./services'); 

app.get('/test-trigger', (req, res) => {
    // 1. Fire-and-Forget: 先立刻回應，避免 GitHub Timeout
    res.send('🚀 測試指令已接收！正在背景執行「AI 人工智慧」搜尋，完成後將傳送報告至 Telegram...');

    console.log("🧪 [Test] 收到測試請求，開始執行關鍵字搜尋 (審核模式)...");

    // ✅ 設定目標 ID：優先讀取 Render 環境變數，沒有的話使用備用 ID
    const TARGET_CHAT_ID = process.env.MY_CHAT_ID || '956162690'; 

    // 2. 定義「回調函式 (Callback)」
    const reportHandler = async (data) => {
        try {
            console.log(`📥 [Server] 收到 Service 回傳的報告，準備發送至 ID: ${TARGET_CHAT_ID}...`);
            
            // 組合報告內容 (讓你好讀、好審核)
            const reportMessage = `
📊 **關鍵字研究報告**
#${data.keyword}

${data.content}

---------------------------
🔗 **參考與來源**
(來源圖/文: ${data.imageUrl || '無圖片'})
`;
            // 發送給你的 Telegram (Bridge-room) - 使用純文字避免格式錯誤
            await bot.sendMessage(TARGET_CHAT_ID, reportMessage);
            
            console.log("✅ [Server] 報告已發送至 Telegram 審核頻道");

        } catch (err) {
            console.error("❌ [Server] 發送報告失敗:", err.message);
            // 嘗試發送錯誤訊息給本人
            bot.sendMessage(TARGET_CHAT_ID, `⚠️ 報告發送失敗: ${err.message}`).catch(() => {});
        }
    };

    // 3. 啟動任務 (審核模式)
    services.startDailyRoutine(['AI 人工智慧'], reportHandler)
        .then(() => console.log("✅ [Test] 搜尋任務流程結束 (等待報告產出)"))
        .catch(err => console.error("❌ [Test] 測試任務失敗:", err));
});
// ==========================================
// 📡 RSS 專用測試窗口 (明天合併前的前哨戰)
// ==========================================
app.get('/rss-test', async (req, res) => {
    const region = req.query.region || 'GB'; // 預設測英國
    res.send(`📡 RSS 測試啟動：正在抓取 ${region} 地區新聞...`);
    console.log(`📡 [RSS Test] 收到請求，目標地區：${region}`);

    const TARGET_CHAT_ID = process.env.MY_CHAT_ID || '956162690'; 

    try {
        let newsItems = [];
        let sourceName = "";

        // 1. 根據參數決定抓哪一國
        if (region === 'FR') {
            newsItems = await services.getFRNews();
            sourceName = "🇫🇷 法國焦點 (France 24)";
        } else if (region === 'GB') {
            newsItems = await services.getGBNews();
            sourceName = "🇬🇧 英國快訊 (BBC)";
        } else {
            return console.log("❌ 未知的地區參數");
        }

        // 2. 檢查是否有資料
        if (!newsItems || newsItems.length === 0) {
            await bot.sendMessage(TARGET_CHAT_ID, `⚠️ [RSS Warning] ${sourceName} 目前抓不到任何新聞 (可能是來源暫時無法連線)`);
            return;
        }

        // 3. 格式化訊息 (因為還沒過 Gemini，我們先用條列式呈現)
        let message = `📰 **${sourceName} - 最新快訊**\n(原始 RSS 測試)\n\n`;
        
        // 只取前 8 則，避免訊息太長
        newsItems.slice(0, 8).forEach((item, index) => {
            message += `${index + 1}. [${item.title}](${item.link})\n\n`;
        });

        message += `---------------------------\n🤖 測試完畢，確認 RSS 管道暢通`;

        // 4. 發送
        await sendRobustMessage(TARGET_CHAT_ID, message);
        console.log(`✅ [RSS Test] ${region} 新聞已發送`);

    } catch (error) {
        console.error("❌ RSS 測試失敗:", error);
        bot.sendMessage(TARGET_CHAT_ID, `⚠️ RSS 測試發生錯誤: ${error.message}`).catch(()=>{});
    }
});
app.get('/', (req, res) => { res.send('Info Commander is Running (Ver 1229_03 Gemini 3 - Bridge Mode)'); });
app.listen(port, () => { console.log(`Server is running on port ${port}`); });