/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Web Dashboard Edition)
 * ==============================================================================
 * [Architecture] Big 1(PDF/Web) + Big 3(Gate/Make) + Big 2(Stubbed Schedule)
 * [Version]      1228_Fix_Reference_Error
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const services = require('./services');

// ============================================================================
// 1. 初始化設定 (這一段一定要在最上面！)
// ============================================================================
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.code}`));

const app = express();
const port = process.env.PORT || 10000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Middleware
app.use(express.json());
app.use(express.static('public'));

console.log("🚀 Commander System Online (Make Integration Ready)");

// ============================================================================
// === UX 輔助函式 ===
// ============================================================================
async function sendNewsWithUX(chatId, headerEmoji, headerTitle, newsData) {
    if (!newsData || newsData.length === 0) return;
    await bot.sendMessage(chatId, `${headerEmoji} **${headerTitle}**`, { parse_mode: 'Markdown' });
    await delay(500); 
    const formattedItems = newsData.map(item => `🔹 *[${item.sourceName}]* ${item.title}`).map(str => str + "\n\n");
    const CHUNK_SIZE = 5; 
    for (let i = 0; i < formattedItems.length; i += CHUNK_SIZE) {
        const chunk = formattedItems.slice(i, i + CHUNK_SIZE);
        await bot.sendMessage(chatId, chunk.join(''), { parse_mode: 'Markdown' });
        await delay(300);
    }
}

// ============================================================================
// === Big 1: Bridge-room (主動閱讀 - 私訊摘要) ===
// ============================================================================
bot.on('message', async (msg) => {
    // 過濾掉非私訊、檔案、非網址訊息
    if (msg.chat.type !== 'private' || msg.document || !msg.text?.startsWith('http')) return;
    if (msg.text.includes('youtube.com') || msg.text.includes('youtu.be')) return;
    
    await bot.sendMessage(msg.chat.id, "🔍 讀取網頁中...");
    const summary = await services.processUrl(msg.text);
    await bot.sendMessage(msg.chat.id, `📰 **摘要**\n\n${summary}`, { parse_mode: 'Markdown' });
});

bot.on('document', async (msg) => {
    if (msg.chat.type === 'private' && msg.document.mime_type?.includes('pdf')) {
        await bot.sendMessage(msg.chat.id, "📄 讀取 PDF 中...");
        try {
            const link = await bot.getFileLink(msg.document.file_id);
            const summary = await services.processPDF(link);
            await bot.sendMessage(msg.chat.id, summary, { parse_mode: 'Markdown' });
        } catch (e) { await bot.sendMessage(msg.chat.id, "❌ 失敗"); }
    }
});

// ============================================================================
// === Big 3: Gate-Room (社群發布 - 智能進度回報版) ===
// ============================================================================
bot.on('channel_post', async (msg) => {
    // 1. 檢查是否為目標頻道
    if (process.env.GATE_CHANNEL_ID && String(msg.chat.id) !== String(process.env.GATE_CHANNEL_ID)) return;
    
    const rawText = msg.text || msg.caption;
    if (!rawText) return;

    // 2. [UX] 立即回傳「處理中」訊息
    const sentMsg = await bot.sendMessage(msg.chat.id, "🔍 正在讀取並分析內容，請稍候...");

    // 3. 呼叫 Service 處理 (讀取 + AI 改寫)
    const draft = await services.processGateMessage(rawText);

    if (draft) {
        // 4. 準備最終內容
        let content = draft.content;
        
        // 如果有圖，將圖片網址附在最後，並加上 Image Source 標記讓 Make 抓取
        if (draft.imageUrl) content += `\n\n🖼️ IMAGE_SRC: ${draft.imageUrl}`;
        // 重要：附上原始來源連結，讓 Make 路徑 C (資料庫) 可以使用
        if (draft.sourceUrl) content += `\n🔗 SOURCE_URL: ${draft.sourceUrl}`;

        // 5. [UX] 編輯原本那則「處理中」的訊息，變成最終結果 + 按鈕
        await bot.editMessageText(content, {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id,
            disable_web_page_preview: false, 
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🏀 體育版', callback_data: 'post_sports' }, 
                        { text: '💰 財經版', callback_data: 'post_finance' } 
                    ],
                    [{ text: '💾 存入庫存', callback_data: 'save_vault' }]
                ]
            }
        });
    } else {
        await bot.editMessageText("⚠️ 處理失敗，無法讀取網頁或 AI 發生錯誤。", {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id
        });
    }
});

// 處理按鈕點擊 (觸發 Make)
bot.on('callback_query', async (q) => {
    await bot.answerCallbackQuery(q.id, { text: '🚀 發射!' });

    let content = q.message.text;
    let imageUrl = '';
    let sourceUrl = '';

    const imgMatch = content.match(/🖼️ IMAGE_SRC: (.*)/);
    if (imgMatch) { 
        imageUrl = imgMatch[1]; 
        content = content.replace(imgMatch[0], '').trim();
    }

    const srcMatch = content.match(/🔗 SOURCE_URL: (.*)/);
    if (srcMatch) {
        sourceUrl = srcMatch[1];
        content = content.replace(srcMatch[0], '').trim();
    }

    const payload = {
        type: q.data,          
        content: content,      
        imageUrl: imageUrl,    
        sourceUrl: sourceUrl,  
        timestamp: new Date().toISOString()
    };

    services.dispatchToMake(payload);

    await bot.editMessageText(`${content}\n\n✅ [已發送到 ${q.data}]`, { 
        chat_id: q.message.chat.id, 
        message_id: q.message.message_id, 
        reply_markup: { inline_keyboard: [] } 
    });
});

// ============================================================================
// === Big 2: 自動化排程 (目前為空殼，等待測試後恢復) ===
// ============================================================================
// 這些排程目前呼叫的是 services 裡的空殼函式，不會報錯，但也不會做任何事。
// 測試完成後，我們會再把 services 裡的邏輯填回來。

schedule.scheduleJob('0 21 * * *', async () => { /* Daily YouTube Popular Stub */ });
schedule.scheduleJob('10 21 * * *', async () => { /* Monitor Morning Stub */ });
schedule.scheduleJob('30 21 * * *', function(){ services.startDailyRoutine([], null); });
schedule.scheduleJob('10 22 * * *', async () => { /* JP News Stub */ });
schedule.scheduleJob('20 22 * * *', async () => { /* US News Stub */ });
schedule.scheduleJob('0 5 * * *', async () => { /* Monitor Afternoon Stub */ });
schedule.scheduleJob('0 6 * * *', function(){ services.startDailyRoutine([], null); });
schedule.scheduleJob('40 6 * * *', async () => { /* GB News Stub */ });
schedule.scheduleJob('10 8 * * *', async () => { /* FR News Stub */ });


// ============================================================================
// === Web Dashboard API (Express Routes) ===
// ============================================================================
app.post('/api/rss', async (req, res) => { res.json([]); });
app.post('/api/summarize', async (req, res) => {
    const { url } = req.body;
    const summary = await services.processUrl(url);
    res.json({ summary });
});
app.post('/api/gate-draft', async (req, res) => {
    const { text } = req.body;
    const draft = await services.processGateMessage(text);
    res.json(draft);
});
app.post('/api/publish', async (req, res) => {
    await services.dispatchToMake(req.body);
    res.json({ success: true });
});

// 啟動 Server
app.listen(port, () => console.log(`Server running on port ${port}`));