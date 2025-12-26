/**
 * ==============================================================================
 * 🛠️ Info Commander Server
 * ==============================================================================
 * [Architecture] Big 1(PDF/Web) + Big 2(Auto) + Big 3(Gate)
 * [Principle]    Simple & Easy to Maintain
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const services = require('./services'); 

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (e) => console.log(`[Polling Error] ${e.code}`));
const app = express();
const port = process.env.PORT || 10000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

console.log("🚀 Commander System Online (Streamlined Version)");

// === Big 1: Bridge-room (主動閱讀) ===
// A. 讀連結 (暴力法，不處理 YouTube)
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private' || msg.document || !msg.text?.startsWith('http')) return;
    
    // 如果是指揮官手動貼 YouTube，就直接忽略 (或回傳: 請貼標題至 Gate)
    if (msg.text.includes('youtube.com') || msg.text.includes('youtu.be')) return;

    await bot.sendMessage(msg.chat.id, "🔍 讀取網頁中...");
    const summary = await services.processUrl(msg.text);
    await bot.sendMessage(msg.chat.id, `📰 **摘要**\n\n${summary}`, { parse_mode: 'Markdown' });
});

// B. 讀 PDF
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

// === Big 3: Gate-Room (社群發布) ===
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

// === Big 2: 自動化排程 (每日早晨) ===
schedule.scheduleJob('0 21 * * *', async () => { // 05:00
    if(!process.env.MY_CHAT_ID) return;
    const vids = await services.getMostPopularVideos('TW');
    bot.sendMessage(process.env.MY_CHAT_ID, "🔥 **YouTube 熱門**\n" + vids.map(v => `• [${v.title}](${v.url})`).join('\n'), {parse_mode:'Markdown'});
});

schedule.scheduleJob('10 21 * * *', async () => { // 05:10
    const channels = (process.env.MONITOR_CHANNELS || '').split(',');
    for (const ch of channels) {
        if(!ch) continue;
        const vids = await services.checkChannelLatestVideo(ch.trim());
        for (const v of vids) bot.sendMessage(process.env.MY_CHAT_ID, `🚨 **大神發片**\n${v.title}\n${v.url}`);
        await delay(5000);
    }
});

schedule.scheduleJob('0 22 * * *', async () => { // 06:00
    if(!process.env.MY_CHAT_ID) return;
    const trends = await services.getGlobalTrends('TW');
    bot.sendMessage(process.env.MY_CHAT_ID, "🌎 **Google 熱搜**\n" + trends.map((t,i)=>`${i+1}. ${t.title}`).join('\n'));
});

schedule.scheduleJob('30 21 * * *', async () => { // 05:30
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

app.get('/', (req, res) => res.send('Info Commander Lite Online'));
app.listen(port, () => console.log(`Server running on port ${port}`));