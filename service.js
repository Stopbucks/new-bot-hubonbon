/**
 * ==============================================================================
 * 🛠️ Info Commander Server (The Thin Controller)
 * ==============================================================================
 * [Architecture] Big 2 (Cron) + Big 3 (Event Driven/Stateless)
 * [Version]      1226_Big3_Unified
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const services = require('./services'); // 引入參謀本部

const token = process.env.TELEGRAM_TOKEN;
const gateChannelId = process.env.GATE_CHANNEL_ID; // 必須設定

if (!token) { console.error("❌ 缺少 TELEGRAM_TOKEN"); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });
const app = express();
const port = process.env.PORT || 10000;

console.log("🚀 Commander System Online (Big 2 + Big 3 Integrated)");

// 工具：延遲
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 🔔 Big 3: Gate-Room 監聽區 (無狀態核心)
// ==========================================

// 1. 監聽頻道貼文 (Channel Post)
bot.on('channel_post', async (msg) => {
    // 檢查是否為指定的 Gate-Room
    if (gateChannelId && String(msg.chat.id) !== String(gateChannelId)) return;
    
    console.log(`[Gate] 收到新素材: ${msg.message_id}`);
    
    // 取得文字內容 (包含轉發的文字 或 連結)
    const rawText = msg.text || msg.caption || "";
    if (!rawText) return;

    // 呼叫 Service 進行 Gemini 改寫
    const draft = await services.processGateMessage(rawText);

    if (draft) {
        // 為了無狀態，我們將 ImageUrl 藏在文字最後 (或直接顯示)
        // 這裡我們用一個技巧：把 ImageUrl 放在文字最後一行，並用特殊標記，方便之後提取
        let finalContent = draft.content;
        if (draft.imageUrl) {
            finalContent += `\n\n🖼️ IMAGE_SRC: ${draft.imageUrl}`;
        }

        const opts = {
            reply_to_message_id: msg.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🏀 體育版', callback_data: 'post_sports' },
                        { text: '💰 財經版', callback_data: 'post_finance' }
                    ],
                    [{ text: '💾 存入庫存 (Big 4)', callback_data: 'save_vault' }]
                ]
            }
        };

        // 回覆草稿
        await bot.sendMessage(msg.chat.id, finalContent, opts);
    }
});

// 2. 監聽按鈕點擊 (Callback Query)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const target = callbackQuery.data;
    const chatId = msg.chat.id;

    // 停止按鈕轉圈圈
    await bot.answerCallbackQuery(callbackQuery.id, { text: '🚀 發射程序啟動...' });

    // 從訊息中提取內容與圖片 (Stateless!)
    let content = msg.text;
    let imageUrl = '';
    
    // 解析我們剛剛藏的圖片標記
    const imgMatch = content.match(/🖼️ IMAGE_SRC: (.*)/);
    if (imgMatch) {
        imageUrl = imgMatch[1];
        content = content.replace(imgMatch[0], '').trim(); // 移除標記，不發布出去
    }

    // 準備 Payload
    const payload = {
        target: target,
        content: content,
        imageUrl: imageUrl,
        timestamp: new Date().toISOString()
    };

    // 呼叫 Service 發送
    await services.dispatchToMake(payload);

    // 修改原訊息，標記為已發送
    await bot.editMessageText(`${content}\n\n✅ [已發射: ${target}]`, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] } // 移除按鈕
    });
});


// ==========================================
// ⏰ Big 2: 定時排程區
// ==========================================

// 05:00 娛樂榜 (簡化版)
schedule.scheduleJob('0 21 * * *', async function(){
    console.log('⏰ [05:00 Job] Top Videos');
    const regions = ['TW', 'US', 'JP'];
    let report = "🔥 **YouTube 昨日發燒**\n";
    for (const r of regions) {
        const vids = await services.getMostPopularVideos(r);
        report += `\n[${r}]\n` + vids.map(v => `• [${v.title}](${v.url})`).join('\n');
    }
    if(process.env.MY_CHAT_ID) bot.sendMessage(process.env.MY_CHAT_ID, report, { parse_mode: 'Markdown' });
});

// 05:10 頻道監控 (邏輯移至 Service，這裡只負責跑迴圈)
schedule.scheduleJob('10 21 * * *', async function(){
    const channels = (process.env.MONITOR_CHANNELS || '').split(',');
    console.log(`⏰ [05:10 Job] Monitor ${channels.length}`);
    
    for (const chId of channels) {
        if(!chId) continue;
        const newVids = await services.checkChannelLatestVideo(chId.trim());
        if (newVids.length > 0) {
            console.log(`[Monitor] ${chId} Found ${newVids.length}`);
            for (const v of newVids) {
                // 這裡可以選擇直接發給 Gate-room (如果想自動化的話)
                // 目前先照舊發給您個人
                if(process.env.MY_CHAT_ID) {
                   await bot.sendMessage(process.env.MY_CHAT_ID, `🚨 **大神發片**\n${v.title}\n${v.url}`);
                }
            }
        }
        await delay(180000); // 休息 3 分鐘
    }
});

// 06:00 全球熱搜 (修復版)
schedule.scheduleJob('0 22 * * *', async function(){
    console.log('⏰ [06:00 Job] RSS Trends');
    const trends = await services.getGlobalTrends('TW'); // 呼叫 Services
    let msg = "🌎 **Google TW 熱搜**\n";
    trends.forEach((t, i) => msg += `${i+1}. ${t.title}\n`);
    if(process.env.MY_CHAT_ID) bot.sendMessage(process.env.MY_CHAT_ID, msg);
});

// 08:00 每日議題
schedule.scheduleJob('0 0 * * *', async function(){
    const topics = (process.env.DAILY_TOPIC || '').split(',');
    for (const topic of topics) {
        if(!topic) continue;
        console.log(`⏰ [Daily] ${topic}`);
        // 完整流程都在 Service 裡，這裡只要組裝
        const yt = await services.searchYouTube(topic);
        if(yt) {
            const news = await services.searchGoogle(yt.title);
            const analysis = await services.generateAnalysisV2(yt, news);
            const img = await services.fetchSmartImage(analysis.image_decision.keyword, analysis.image_decision.type);
            
            // 發給個人檢查，或者直接發 Make
            // 這裡示範直接發 Make (全自動)
            await services.dispatchToMake({
                target: 'auto_daily',
                content: analysis.content,
                imageUrl: img || ''
            });
        }
        await delay(600000); // 休息 10 分鐘
    }
});

// Web Server Keep-Alive
app.get('/', (req, res) => res.send('Info Commander Big 3 Online'));
app.listen(port, () => console.log(`Server running on port ${port}`));