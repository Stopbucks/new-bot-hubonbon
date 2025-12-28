/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Web Dashboard Edition)
 * ==============================================================================
 * [Architecture] Big 1(PDF/Web) + Big 2(Split Schedule) + Big 3(Gate)
 * [Version]      1228_Server_Final_Split
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
// === Big 1: Bridge-room (主動閱讀 - Telegram) ===
// ============================================================================
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' || msg.document || !msg.text?.startsWith('http')) return;
    if (msg.text.includes('youtube.com') || msg.text.includes('youtu.be')) return;
    
    // [Stage 1] 立即回應，防止 User 焦慮
    await bot.sendMessage(msg.chat.id, "🔍 讀取網頁中...");
    
    // [Stage 2] 執行分析
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
// === Big 2: 自動化排程 (分流版) ===
// ============================================================================

// 🛠️ 共用函式：執行頻道監控並回報 (含 AI 400字報告)
async function runChannelMonitor(channelString, label) {
    if(!process.env.MY_CHAT_ID) return;
    const channels = (channelString || '').split(',');
    
    console.log(`[Scheduler] 執行 ${label}...`);

    for (const ch of channels) {
        if(!ch) continue;
        const video = await services.checkChannelLatestVideo(ch.trim());
        
        if (video) {
            // 📝 格式：真實資料 + AI 整理區塊
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
        await delay(10000); // 頻道間隔緩衝
    }
}

// 🕒 [時段一] 05:00 (TW) - 熱門影片 (維持原樣)
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

// 🕒 [時段二] 05:10 (TW) - 大神監控 Group A (Morning)
schedule.scheduleJob('10 21 * * *', async () => { 
    // 對應 .env: MONITOR_CHANNELS_MORNING
    await runChannelMonitor(process.env.MONITOR_CHANNELS_MORNING, "☀️ 晨間頻道");
});

// 🕒 [時段三] 05:30 (TW) - 關鍵字分析 Morning (Finance)
schedule.scheduleJob('30 21 * * *', function(){ 
    console.log('[Scheduler] 啟動 💰 晨間財經...');
    const topics = (process.env.DAILY_TOPIC_FINANCE || '').split(',');
    
    // Callback 注入：Service 做完後，執行這裡的代碼
    services.startDailyRoutine(topics, async (result) => {
        if(process.env.MY_CHAT_ID) {
            await bot.sendMessage(process.env.MY_CHAT_ID, 
                `💰 **晨間財經：${result.keyword}**\n\n${result.content}`
            );
        }
    });
});

// 🕒 [時段四] 06:00 (TW) - Google 熱搜
schedule.scheduleJob('0 22 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    try {
        const trends = await services.getGlobalTrends('TW');
        if (trends && trends.length > 0) {
            bot.sendMessage(process.env.MY_CHAT_ID, "🌎 **Google 熱搜**\n" + trends.map((t,i)=>`${i+1}. ${t.title}`).join('\n'));
        }
    } catch (e) {}
});

// 🕒 [時段五] 12:40 (TW) - 關鍵字分析 Noon (Tech/Leisure)
// UTC 04:40 = TW 12:40
schedule.scheduleJob('40 4 * * *', function(){
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

// 🕒 [時段六] 13:00 (TW) - 大神監控 Group B (Afternoon)
// UTC 05:00 = TW 13:00
schedule.scheduleJob('0 5 * * *', async () => { 
    // 對應 .env: MONITOR_CHANNELS_AFTERNOON
    await runChannelMonitor(process.env.MONITOR_CHANNELS_AFTERNOON, "☕ 午間頻道");
});

// 🕒 [時段七] 23:45 (TW) - 英國熱搜 (Bonus)
schedule.scheduleJob('45 15 * * *', async () => {
    if(!process.env.MY_CHAT_ID) return;
    const content = await services.getQuickTrends('GB');
    bot.sendMessage(process.env.MY_CHAT_ID, "🇬🇧 **英國熱搜**\n" + content, {parse_mode: 'Markdown'});
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

// ✅ 手動觸發分析 (防 Timeout 機制)
app.post('/api/trigger-daily', (req, res) => {
    // 1. 先回傳 OK
    res.json({ status: 'success', message: '背景分析已啟動' });
    
    // 2. 背景執行
    const customKeywords = req.body.keywords || [];
    services.startDailyRoutine(customKeywords, async (result) => {
        if(process.env.MY_CHAT_ID) await bot.sendMessage(process.env.MY_CHAT_ID, `手動分析完成：${result.keyword}\n\n${result.content}`);
    });
});

// 啟動 Server
app.listen(port, () => console.log(`Server running on port ${port}`));