/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Web Dashboard Edition)
 * ==============================================================================
 * [Architecture] Big 1(PDF/Web) + Big 2(Auto) + Big 3(Gate) + Web Interface
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

// 1. Middleware
app.use(express.json());
app.use(express.static('public'));

console.log("🚀 Commander System Online (Web Edition)");

// === Big 1: Bridge-room (主動閱讀 - Telegram) ===
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

// === Big 3: Gate-Room (社群發布 - Telegram) ===
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
// === Big 2: 自動化排程 (UPDATED v1227) ===
// ============================================================================

// 🕒 時段一：每日 21:00 UTC (台灣 05:00) - 多國熱門影片
schedule.scheduleJob('0 21 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    
    // ✅ 更新：新增多國清單 (TW, JP, US, GB)
    const regions = ['TW', 'JP', 'US', 'GB'];

    for (const region of regions) {
        const vids = await services.getMostPopularVideos(region);
        
        // 國旗對應
        const flags = { 'TW': '🇹🇼', 'JP': '🇯🇵', 'US': '🇺🇸', 'GB': '🇬🇧' };
        const flag = flags[region] || region;

        if (vids.length > 0) {
            await bot.sendMessage(
                process.env.MY_CHAT_ID, 
                `🔥 **YouTube 熱門 - ${flag}**\n` + vids.map(v => `• [${v.title}](${v.url})`).join('\n'), 
                { parse_mode: 'Markdown' }
            );
        }
        
        // ✅ 更新：10 秒緩衝 (輕量化負載)
        await delay(10000);
    }
});

// 🕒 時段二：每日 21:10 UTC (台灣 05:10) - 大神頻道監控
schedule.scheduleJob('10 21 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    const channels = (process.env.MONITOR_CHANNELS || '').split(',');
    
    for (const ch of channels) {
        if(!ch) continue;
        
        // ✅ 更新：呼叫新的兩段式 Service
        const video = await services.checkChannelLatestVideo(ch.trim());
        
        // 寧缺勿濫：只有在真正有新片時才發送
        if (video) {
            // ✅ 更新：格式調整為 [頻道名] + 標題 + 連結
            await bot.sendMessage(
                process.env.MY_CHAT_ID, 
                `🚨 **[${video.channelTitle}]**\n${video.title}\n${video.url}`
            );
        }
        
        // ✅ 更新：10 秒緩衝 (維持一致性)
        await delay(10000);
    }
});

// 🕒 時段三：每日 21:30 UTC (台灣 05:30) - 每日議題分析
// [NOTE] 此區塊尚未修改，保留原樣 (Pending Update)
schedule.scheduleJob('30 21 * * *', async () => { 
    const topics = (process.env.DAILY_TOPIC || '').split(',');
    for (const t of topics) {
        if(!t) continue;
        const yt = await services.searchYouTube(t);
        if(yt) {
            const news = await services.searchGoogle(yt.title);
            const analysis = await services.generateAnalysisV2(yt, news);
            const img = await services.fetchSmartImage(analysis.image_decision.keyword, 'news');
            await services.dispatchToMake({ target: 'auto_daily', content: analysis.content, imageUrl: img || '' });
        }
        await delay(10000);
    }
});

// 🕒 時段四：每日 22:00 UTC (台灣 06:00) - Google 熱搜
// [NOTE] 此區塊尚未修改，保留原樣 (Pending Update)
schedule.scheduleJob('0 22 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    const trends = await services.getGlobalTrends('TW');
    bot.sendMessage(process.env.MY_CHAT_ID, "🌎 **Google 熱搜**\n" + trends.map((t,i)=>`${i+1}. ${t.title}`).join('\n'));
});

// ============================================================================
// === 🆕 Web Dashboard API ===
// ============================================================================
app.post('/api/rss', async (req, res) => {
    const rssSources = [
        { name: 'NYTimes', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
        { name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
        { name: 'Guardian', url: 'https://www.theguardian.com/world/rss' },
        { name: 'ABC-AU', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml' },
        { name: 'WSJ', url: 'https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml' },
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
    const payload = req.body; 
    await services.dispatchToMake(payload);
    res.json({ success: true });
});

// 啟動 Server
app.listen(port, () => console.log(`Server running on port ${port}`));