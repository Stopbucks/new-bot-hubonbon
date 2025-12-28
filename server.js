/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Final Integration)
 * ==============================================================================
 * [Architecture] Big 1(Read) + Big 3(Gate/Make) + Big 2(Active Schedule)
 * [Version]      1229_Final_Restore
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const services = require('./services');

// 1. 初始化設定
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.code}`));

const app = express();
const port = process.env.PORT || 10000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Middleware
app.use(express.json());
app.use(express.static('public'));

console.log("🚀 Commander System Online (Full Capability Restored)");

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
                        `🔗 ${video.url}\n` +
                        `------------------------------\n` +
                        `${video.aiAnalysis}\n`;
            await bot.sendMessage(process.env.MY_CHAT_ID, msg);
        }
        await delay(10000); 
    }
}

// ============================================================================
// === Big 1: Bridge-room (主動閱讀) ===
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
// === Big 3: Gate-Room (社群發布 & Make) ===
// ============================================================================
bot.on('channel_post', async (msg) => {
    if (process.env.GATE_CHANNEL_ID && String(msg.chat.id) !== String(process.env.GATE_CHANNEL_ID)) return;
    const rawText = msg.text || msg.caption;
    if (!rawText) return;

    const sentMsg = await bot.sendMessage(msg.chat.id, "🔍 正在讀取並分析內容，請稍候...");
    const draft = await services.processGateMessage(rawText);

    if (draft) {
        let content = draft.content;
        if (draft.imageUrl) content += `\n\n🖼️ IMAGE_SRC: ${draft.imageUrl}`;
        if (draft.sourceUrl) content += `\n🔗 SOURCE_URL: ${draft.sourceUrl}`;

        await bot.editMessageText(content, {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id,
            disable_web_page_preview: false, 
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏀 體育版', callback_data: 'post_sports' }, { text: '💰 財經版', callback_data: 'post_finance' }],
                    [{ text: '💾 存入庫存', callback_data: 'save_vault' }]
                ]
            }
        });
    } else {
        await bot.editMessageText("⚠️ 處理失敗。", { chat_id: msg.chat.id, message_id: sentMsg.message_id });
    }
});

bot.on('callback_query', async (q) => {
    await bot.answerCallbackQuery(q.id, { text: '🚀 發射!' });
    let content = q.message.text;
    let imageUrl = '', sourceUrl = '';

    const imgMatch = content.match(/🖼️ IMAGE_SRC: (.*)/);
    if (imgMatch) { imageUrl = imgMatch[1]; content = content.replace(imgMatch[0], '').trim(); }
    
    const srcMatch = content.match(/🔗 SOURCE_URL: (.*)/);
    if (srcMatch) { sourceUrl = srcMatch[1]; content = content.replace(srcMatch[0], '').trim(); }

    services.dispatchToMake({
        type: q.data, content, imageUrl, sourceUrl, timestamp: new Date().toISOString()
    });

    await bot.editMessageText(`${content}\n\n✅ [已發送到 ${q.data}]`, { 
        chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } 
    });
});

// ============================================================================
// === Big 2: 自動化排程 (功能回歸) ===
// ============================================================================

// 🕒 [21:00 UTC] YouTube 熱門
schedule.scheduleJob('0 21 * * *', async () => { 
    if(!process.env.MY_CHAT_ID) return;
    const regions = ['TW', 'JP', 'US'];
    for (const region of regions) {
        const vids = await services.getMostPopularVideos(region);
        if (vids.length > 0) {
            await bot.sendMessage(process.env.MY_CHAT_ID, `🔥 **YT 熱門 ${region}**\n` + vids.map(v => `• [${v.title}](${v.url})`).join('\n'), { parse_mode: 'Markdown' });
        }
        await delay(5000);
    }
});

// 🕒 [21:10 UTC] 晨間頻道監控
schedule.scheduleJob('10 21 * * *', async () => { await runChannelMonitor(process.env.MONITOR_CHANNELS_MORNING, "☀️ 晨間頻道"); });

// 🕒 [21:30 UTC] 晨間財經研報
schedule.scheduleJob('30 21 * * *', function(){ 
    const topics = (process.env.DAILY_TOPIC_FINANCE || '').split(',');
    services.startDailyRoutine(topics, async (result) => {
        if(process.env.MY_CHAT_ID) await bot.sendMessage(process.env.MY_CHAT_ID, `💰 **晨間財經：${result.keyword}**\n\n${result.content}`);
    });
});

// 🕒 [22:10 UTC] 日本/美國情報
schedule.scheduleJob('10 22 * * *', async () => { if(process.env.MY_CHAT_ID) sendNewsWithUX(process.env.MY_CHAT_ID, "🇯🇵", "日本焦點", await services.getJPNews()); });
schedule.scheduleJob('20 22 * * *', async () => { if(process.env.MY_CHAT_ID) sendNewsWithUX(process.env.MY_CHAT_ID, "🗽", "美國早報", await services.getUSNews()); });

// 🕒 [05:00 UTC] 午間監控
schedule.scheduleJob('0 5 * * *', async () => { await runChannelMonitor(process.env.MONITOR_CHANNELS_AFTERNOON, "☕ 午間頻道"); });

// 🕒 [06:00 UTC] 午間報告
schedule.scheduleJob('0 6 * * *', function(){
    const topics = (process.env.DAILY_TOPIC_TECH || '').split(',');
    services.startDailyRoutine(topics, async (result) => {
        if(process.env.MY_CHAT_ID) await bot.sendMessage(process.env.MY_CHAT_ID, `🍱 **午間報告：${result.keyword}**\n\n${result.content}`);
    });
});

// 🕒 [06:40 UTC] 英國/法國情報
schedule.scheduleJob('40 6 * * *', async () => { if(process.env.MY_CHAT_ID) sendNewsWithUX(process.env.MY_CHAT_ID, "🇬🇧", "英國快訊", await services.getGBNews()); });
schedule.scheduleJob('10 8 * * *', async () => { if(process.env.MY_CHAT_ID) sendNewsWithUX(process.env.MY_CHAT_ID, "🇫🇷", "法國觀點", await services.getFRNews()); });

// ============================================================================
// === Web Dashboard API ===
// ============================================================================
app.post('/api/rss', async (req, res) => { res.json(await services.fetchAllRSS([{name:'BBC',url:'http://feeds.bbci.co.uk/news/rss.xml'}])); });
app.post('/api/summarize', async (req, res) => { res.json({ summary: await services.processUrl(req.body.url) }); });
app.post('/api/gate-draft', async (req, res) => { res.json(await services.processGateMessage(req.body.text)); });
app.post('/api/publish', async (req, res) => { await services.dispatchToMake(req.body); res.json({ success: true }); });

// 啟動 Server
app.listen(port, () => console.log(`Server running on port ${port}`));