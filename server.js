/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (Ver 1224_15 Final Release)
 * ==============================================================================
 * [Schedule (TW Time / UTC Time)]
 * 05:00 TW (21:00 UTC) | YouTube 熱門榜
 * 05:10 TW (21:10 UTC) | 頻道監控 (High Tolerance Buffer)
 * 06:00 TW (22:00 UTC) | Google 全球熱搜
 * 08:00 TW (00:00 UTC) | 每日議題 (10min interval)
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

// 引入全功能引擎
const { 
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo,
    getGoogleTrends, searchGoogle, 
    generateAnalysis, generateInference, searchImage 
} = require('./services');

const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; 
const port = process.env.PORT || 10000;

if (!token || !geminiKey) { console.error("❌ 缺漏環境變數"); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();

console.log("🚀 System Starting... (Ver 1224_15 Final)");

// --- 工具：延遲函式 ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Big 1 舊功能 (聊天與網頁摘要) ---
const SYSTEM_PROMPT = `
你是一位資深的「社群新聞編輯」，代號 Info Commander。
請將用戶提供的內容改寫為一篇「Facebook 社群深入淺出文」。
【格式規範】
1. 標題：第一行必須使用 "  ▌ " 開頭。
2. 字體：嚴禁使用粗體。
3. 排版：段落之間空一行，每段 1-3 句話。
4. 語言：繁體中文 (Traditional Chinese)。
`;
async function callGeminiBig1(userContent) {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n素材：${userContent}`);
    return result.response.text();
}
async function getWebContent(url) {
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        $('script, style, nav, footer, header').remove();
        return $('body').text().trim().replace(/\s+/g, ' ').substring(0, 15000);
    } catch (e) { throw new Error("網頁讀取失敗"); }
}

// ==========================================
// ⏰ 任務 1A: 05:00 娛樂熱門榜 (TW 05:00 = UTC 21:00)
// ==========================================
schedule.scheduleJob('0 21 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [05:00 Job] 啟動 YouTube 熱門榜...');

    try {
        const regions = ['TW', 'US', 'JP'];
        let popularReport = "🔥 **昨日 YouTube 發燒影片 (Top 3)**\n";
        
        for (const region of regions) {
            const videos = await getMostPopularVideos(region);
            popularReport += `\n**[${region}]**\n`;
            videos.forEach((v, i) => {
                popularReport += `${i+1}. [${v.title}](${v.url})\n`;
            });
        }
        await bot.sendMessage(chatId, popularReport, { parse_mode: 'Markdown' });
    } catch (e) { console.error("熱門榜錯誤:", e.message); }
});

// ==========================================
// ⏰ 任務 1B: 05:10 頻道監控 (TW 05:10 = UTC 21:10)
// ==========================================
// ⚠️ 注意：建議監控頻道數量不超過 5 位！
schedule.scheduleJob('10 21 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    
    const channels = process.env.MONITOR_CHANNELS ? process.env.MONITOR_CHANNELS.split(',') : [];
    if (channels.length === 0) return;

    console.log(`⏰ [05:10 Job] 啟動頻道監控 (共 ${channels.length} 位)...`);
    await bot.sendMessage(chatId, `🕵️ [頻道監控] 開始巡邏 ${channels.length} 個重點頻道...`);

    for (let i = 0; i < channels.length; i++) {
        const channelId = channels[i].trim();
        if (!channelId) continue;

        try {
            // 1. 檢查該頻道 (回傳影片清單，最多3支)
            const newVideos = await checkChannelLatestVideo(channelId);
            
            if (newVideos && newVideos.length > 0) {
                console.log(`[Monitor] 頻道 ${channelId} 發現 ${newVideos.length} 支新片`);
                
                // 2. 處理該頻道的每一支新片
                for (const video of newVideos) {
                    const news = await searchGoogle(video.title);
                    const inference = await generateInference(video, news);
                    
                    await bot.sendMessage(chatId, `🚨 **大神發片警報**\n${inference}\n\n📺 觀看連結: ${video.url}`);
                    
                    // 🛑 緩衝：同一位大神的下一支影片，等待 60 秒
                    if (newVideos.length > 1) {
                        console.log(`[Buffer] 等待 60 秒處理下一支影片...`);
                        await delay(60000); 
                    }
                }
            } else {
                console.log(`[Monitor] 頻道 ${channelId} 無新片`);
            }

        } catch (err) {
            console.error(`[Monitor Error] Channel ${channelId}:`, err.message);
        }

        // 3. 🛑 大緩衝：檢查下一位大神前，休息 3 分鐘
        if (i < channels.length - 1) { 
            console.log(`[Buffer] 休息 3 分鐘，準備前往下一位大神...`);
            await delay(180000); 
        }
    }
    console.log(`✅ [05:10 Job] 頻道監控任務結束`);
});

// ==========================================
// ⏰ 任務 2: 06:00 全球熱搜 (TW 06:00 = UTC 22:00)
// ==========================================
schedule.scheduleJob('0 22 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [06:00 Job] 啟動全球熱搜...');

    const targets = [
        { geo: 'US', flag: '🇺🇸', name: '美國' },
        { geo: 'GB', flag: '🇬🇧', name: '英國' },
        { geo: 'JP', flag: '🇯🇵', name: '日本' }
    ];

    let trendReport = "🌎 **昨夜今晨全球 Google 熱搜**\n(點擊指令可深入偵查)\n";

    for (const t of targets) {
        const trends = await getGoogleTrends(t.geo);
        trendReport += `\n${t.flag} **${t.name}**\n`;
        trends.forEach((item, i) => {
            const safeKeyword = item.title.replace(/\s+/g, '_');
            trendReport += `${i+1}. ${item.title} (${item.traffic})\n   👉 /search_${safeKeyword}_1\n`;
        });
    }
    
    await bot.sendMessage(chatId, trendReport);
});

// ==========================================
// ⏰ 任務 3: 08:00 每日議題 (TW 08:00 = UTC 00:00)
// ==========================================
schedule.scheduleJob('0 0 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [08:00 Job] 啟動每日議題匯報...');

    const topics = (process.env.DAILY_TOPIC || '').split(/[,，]/).map(t => t.trim()).filter(t => t);
    
    // 每 10 分鐘發送一則
    for (let i = 0; i < topics.length; i++) {
        setTimeout(async () => {
            const topic = topics[i];
            console.log(`[Daily Topic] 執行: ${topic}`);
            const ytData = await searchYouTube(topic, 1);
            if (ytData) {
                const newsData = await searchGoogle(ytData.title);
                const report = await generateAnalysis(ytData, newsData);
                
                // [Phase 2 Image Check]
                const img = await searchImage(ytData.title);
                if (img) await bot.sendPhoto(chatId, img, { caption: report.substring(0, 1000) });
                else await bot.sendMessage(chatId, report);
            }
        }, i * 600000); // 10分鐘 = 600000ms
    }
});

// ==========================================
// 👤 指令與訊息處理
// ==========================================
bot.onText(/\/search(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    let rawInput = match[1].trim().replace(/_/g, ' '); 
    const inputParts = rawInput.split(/\s+/);
    let days = 5; let keyword = rawInput;
    if (inputParts.length > 1 && /^\d+$/.test(inputParts[inputParts.length - 1])) {
        days = parseInt(inputParts.pop());
        keyword = inputParts.join(' ');
    }
    await bot.sendMessage(chatId, `🔍 [手動偵查] ${keyword} (過去 ${days} 天)...`);
    
    const ytData = await searchYouTube(keyword, days);
    if (!ytData) return bot.sendMessage(chatId, `❌ 找不到相關影片`);
    
    const newsData = await searchGoogle(ytData.title);
    const report = await generateAnalysis(ytData, newsData);
    await bot.sendMessage(chatId, report);
});

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    if (!msg.text) return;
    console.log(`[Message] From ${chatId}`); 
    try {
        let content = msg.text;
        if (content.startsWith('http')) {
            await bot.sendChatAction(chatId, 'typing');
            content = await getWebContent(content);
        }
        if (content) {
            const reply = await callGeminiBig1(content);
            await bot.sendMessage(chatId, reply);
        }
    } catch (e) { console.error(e.message); }
});

app.get('/', (req, res) => res.send('Info Commander Ver 1224_15 Final Active'));
app.listen(port, () => console.log(`Server running on port ${port}`));