/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Web Dashboard Edition)
 * ==============================================================================
 * [Architecture] Big 1(PDF/Web) + Big 2(Split Schedule) + Big 3(Gate)
 * [Version]      1228_Server_Final_Max_Load
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const services = require('./services');

// Telegram Setup
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.code}`));

// Express Setup
const app = express();
const port = process.env.PORT || 10000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Middleware
app.use(express.json());
app.use(express.static('public'));

console.log("🚀 Commander System Online (Split Schedule Active)");

// ============================================================================
// === UX 輔助函式：視覺緩衝 + 分批發送 + 呼吸感排版 ===
// ============================================================================
async function sendNewsWithUX(chatId, headerEmoji, headerTitle, newsData) {
    if (!newsData || newsData.length === 0) return;

    // 1. 視覺緩衝
    await bot.sendMessage(chatId, `${headerEmoji} **${headerTitle}**`, { parse_mode: 'Markdown' });
    await delay(500); 

    // 2. 內容排版
    const formattedItems = newsData.map(item => `🔹 *[${item.sourceName}]* ${item.title}`).map(str => str + "\n\n");

    // 3. 分批發送 (Chunking) 🔥 每 5 則切分
    const CHUNK_SIZE = 5; 
    for (let i = 0; i < formattedItems.length; i += CHUNK_SIZE) {
        const chunk = formattedItems.slice(i, i + CHUNK_SIZE);
        const messageBody = chunk.join('');
        
        await bot.sendMessage(chatId, messageBody, { parse_mode: 'Markdown' });
        await delay(300); // 防止發送太快被 Telegram 限流
    }
}

// ============================================================================
// === Big 1: Bridge-room (主動閱讀 - Telegram) ===
// ============================================================================
bot.on('message', async (msg) => {
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
// === Big 3: Gate-Room (社群發布 - Telegram) ===
// ============================================================================
bot.on('channel_post', async (msg) => {
    if (process.env.GATE_CHANNEL_ID && String(msg.chat.id) !== String(process.env.GATE_CHANNEL_ID)) return;
    const rawText = msg.text || msg.caption;
    if (!rawText) return;

    const draft = await services.processGateMessage(rawText);
    if (draft) {
        let content = draft.content;
        if (draft.imageUrl) content += `\n\n🖼️ IMAGE_SRC: ${draft.imageUrl}`;
        await bot.sendMessage(msg.chat.id, content, {
            reply_to_message_id: msg.message_id,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏀 體育版', callback_data: 'post_sports' }, { text: '💰 財經版', callback_data: 'post_finance' }],
                    [{ text: '💾 存入庫存', callback_data: 'save_vault' }]
                ]
            }
        });
    }
});

bot.on('callback_query', async (q) => {
    await bot.answerCallbackQuery(q.id, { text: '🚀 發射!' });
    let content = q.message.text;
    let imageUrl = '';
    const match = content.match(/🖼️ IMAGE_SRC: (.*)/);
    if (match) { imageUrl = match[1]; content = content.replace(match[0], '').trim(); }
    
    await services.dispatchToMake({ target: q.data, content, imageUrl, timestamp: new Date().toISOString() });
    await bot.editMessageText(`${content}\n\n✅ [已發射]`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
});

// ============================================================================
// === Big 2: 自動化排程 (最終版時間表) ===
// ============================================================================

// 🛠️ 共用函式
async function runChannelMonitor(channelString, label) {
    if(!process.env.MY_CHAT_ID) return;
    const channels = (channelString || '').split(',');
    
    console.log(`[Scheduler] 執行 ${label}...`);

    for (const ch of channels) {
        if(!ch) continue;
        const video = await services.checkChannelLatestVideo(ch.trim());
        
        if (video) {
            const msg = `🚨 **${label}：新片上架**\n` +
                        `👤 ${video.channelTitle}\n` +
                        `📺 ${video.title}\n` +
                        `👀 觀看數：${Number(video.viewCount).toLocaleString()}\n` +
                        `🔗 ${video.url}\n` +
                        `------------------------------\n` +
                        `${video.aiAnalysis}\n` + 
                        `------------------------------`;
            
            await bot.sendMessage(process.env.MY_CHAT_ID, msg);
        }
        await delay(10000); 
    }
}

// 🕒 [05:00] YouTube 熱門
schedule.scheduleJob('0 21 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    const regions = ['TW', 'JP', 'US'];
    for (const region of regions) {
        try {
            console.log(`正在處理地區: ${region}`);
            const vids = await services.getMostPopularVideos(region);
            const flags = { 'TW': '🇹🇼', 'JP': '🇯🇵', 'US': '🇺🇸' };
            if (vids && vids.length > 0) {
                await bot.sendMessage(
                    process.env.MY_CHAT_ID, 
                    `🔥 **YouTube 熱門 - ${flags[region] || region}**\n` + vids.map(v => `• [${v.title}](${v.url})`).join('\n'), 
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (innerError) { console.error(`[Error] ${region} 發生錯誤`); }
        await delay(5000);
    }
});

// 🕒 [05:10] 大神監控 A
schedule.scheduleJob('10 21 * * *', async () => { 
    await runChannelMonitor(process.env.MONITOR_CHANNELS_MORNING, "☀️ 晨間頻道");
});

// 🕒 [05:30] Gemini 財經研報
schedule.scheduleJob('30 21 * * *', function(){ 
    console.log('[Scheduler] 啟動 💰 晨間財經...');
    const topics = (process.env.DAILY_TOPIC_FINANCE || '').split(',');
    services.startDailyRoutine(topics, async (result) => {
        if(process.env.MY_CHAT_ID) {
            await bot.sendMessage(process.env.MY_CHAT_ID, 
                `💰 **晨間財經：${result.keyword}**\n\n${result.content}`
            );
        }
    });
});

// 🕒 [06:10] 🇯🇵 日本情報 RSS (UTC 22:10)
schedule.scheduleJob('10 22 * * *', async () => {
    if(!process.env.MY_CHAT_ID) return;
    const news = await services.getJPNews();
    await sendNewsWithUX(process.env.MY_CHAT_ID, "🇯🇵", "日本焦點 (Japan Times/Today)", news);
});

// 🕒 [06:20] 🗽 美國情報 RSS (UTC 22:20)
schedule.scheduleJob('20 22 * * *', async () => {
    if(!process.env.MY_CHAT_ID) return;
    const news = await services.getUSNews();
    await sendNewsWithUX(process.env.MY_CHAT_ID, "🗽", "美國早報觀測 (NYT/Wired)", news);
});

// 🕒 [13:00] 大神監控 B
schedule.scheduleJob('0 5 * * *', async () => { 
    await runChannelMonitor(process.env.MONITOR_CHANNELS_AFTERNOON, "☕ 午間頻道");
});

// 🕒 [14:00] Gemini 午間綜合
schedule.scheduleJob('0 6 * * *', function(){
    console.log('[Scheduler] 啟動 🍱 午間綜合...');
    const topics = (process.env.DAILY_TOPIC_TECH || '').split(',');
    services.startDailyRoutine(topics, async (result) => {
        if(process.env.MY_CHAT_ID) {
            await bot.sendMessage(process.env.MY_CHAT_ID, 
                `🍱 **午間報告：${result.keyword}**\n\n${result.content}`
            );
        }
    });
});

// 🕒 [14:40] 🇬🇧 英國情報 RSS
schedule.scheduleJob('40 6 * * *', async () => {
    if(!process.env.MY_CHAT_ID) return;
    const news = await services.getGBNews();
    await sendNewsWithUX(process.env.MY_CHAT_ID, "🇬🇧", "英國 BBC 快訊", news);
});

// 🕒 [16:10] 🇫🇷 法國情報 RSS (UTC 08:10)
schedule.scheduleJob('10 8 * * *', async () => {
    if(!process.env.MY_CHAT_ID) return;
    const news = await services.getFRNews();
    await sendNewsWithUX(process.env.MY_CHAT_ID, "🇫🇷", "法國觀點 (France 24)", news);
});

// ============================================================================
// === 🆕 Web Dashboard API ===
// ============================================================================
app.post('/api/rss', async (req, res) => {
    const rssSources = [
        { name: 'NYTimes', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
        { name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
        { name: 'Wired', url: 'https://www.wired.com/feed/rss' }
    ];
    const items = await services.fetchAllRSS(rssSources);
    res.json(items);
});

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

// ✅ 手動觸發分析
app.post('/api/trigger-daily', (req, res) => {
    res.json({ status: 'success', message: '背景分析已啟動' });
    const customKeywords = req.body.keywords || [];
    services.startDailyRoutine(customKeywords, async (result) => {
        if(process.env.MY_CHAT_ID) await bot.sendMessage(process.env.MY_CHAT_ID, `手動分析完成：${result.keyword}\n\n${result.content}`);
    });
});

// 啟動 Server
app.listen(port, () => console.log(`Server running on port ${port}`));