/**
 * ==============================================================================
 * 🛠️ Info Commander Main Server (Big 2  Ver 1225_16 Edition)
 * ==============================================================================
 * [Schedule (TW Time / UTC Time)]
 * 05:00 TW (21:00 UTC) | YouTube 熱門榜 (Legacy)
 * 05:10 TW (21:10 UTC) | 頻道監控 (High Tolerance Buffer)
 * 06:00 TW (22:00 UTC) | Global Trend Hunter (RSS Fix)
 * 08:00 TW (00:00 UTC) | 每日議題 (Sequential & Smart Image)
 * ==============================================================================
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const schedule = require('node-schedule');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');
const RSSParser = require('rss-parser'); // 新增: RSS 解析器

// 引入舊有服務 (保留 YouTube 相關功能，其他功能由此檔案接管)
const { 
    searchYouTube, getMostPopularVideos, checkChannelLatestVideo,
    searchGoogle, // 仍需用於輔助搜尋
    generateInference // 保留舊的簡單推論
} = require('./services');

const token = process.env.TELEGRAM_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY; 
const port = process.env.PORT || 10000;

if (!token || !geminiKey) { console.error("❌ 缺漏環境變數"); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiKey);
const app = express();
const parser = new RSSParser();

console.log("🚀 System Starting... (War Room Big 2 Online)");

// --- 工具：延遲函式 ---
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 🧠 Big 2 核心：新一代智能函數 (覆蓋舊邏輯)
// ==========================================

// 1. 雙軌搜圖路由 (Smart Image Router)
async function fetchSmartImage(keyword, type) {
    try {
        let imageUrl = '';
        console.log(`[Image Router] 請求: ${keyword} (Type: ${type})`);

        // 路線 A: Concept -> Unsplash (質感好、省 Google 額度)
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const unsplashUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
            const res = await axios.get(unsplashUrl);
            if (res.data.results && res.data.results.length > 0) {
                imageUrl = res.data.results[0].urls.regular;
                console.log(`[Image] Unsplash 命中`);
            }
        }
        
        // 路線 B: News 或 Unsplash 失敗 -> Google Image (精準、具時效性)
        if (!imageUrl) {
            const googleUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${process.env.GOOGLE_SEARCH_KEY}&searchType=image&num=1`;
            const res = await axios.get(googleUrl);
            if (res.data.items && res.data.items.length > 0) {
                imageUrl = res.data.items[0].link;
                console.log(`[Image] Google Image 命中`);
            }
        }
        
        return imageUrl;
    } catch (e) {
        console.error(`[Image Error] ${e.message}`);
        return null;
    }
}

// 2. Gemini 分析 V2 (輸出 JSON 決策)
async function generateAnalysisV2(ytData, newsData) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // 使用較快模型
    
    const prompt = `
    你是一個全球情報分析師。請針對以下素材進行分析：
    【YouTube 標題】：${ytData.title}
    【相關新聞】：${newsData}

    請輸出一個 **純 JSON 格式** 的回應 (不要 Markdown，不要解釋)，包含兩個欄位：
    1. "content": 一篇繁體中文社群貼文。格式要求：
       - 標題以 "  ▌ " 開頭。
       - 倒金字塔風格 (重點在前)。
       - 段落間空一行。
       - 語氣專業但易讀 (Facebook 風格)。
       - 300字以內。
       - 最後一段列出參考來源。
    
    2. "image_decision": 一個物件，包含：
       - "type": 若內容為具體新聞事件請填 "news"，若為抽象趨勢/教學/概念請填 "concept"。
       - "keyword": 搜尋圖片用的英文關鍵字 (news 用具體名詞，concept 用意境詞)。

    範例 JSON 結構：
    {
      "content": "  ▌ 標題...\n\n內文...",
      "image_decision": { "type": "news", "keyword": "SpaceX Starship" }
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        let responseText = result.response.text();
        // 清理可能產生的 markdown 標記
        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(responseText);
    } catch (e) {
        console.error("Gemini JSON 解析失敗或 API 錯誤:", e.message);
        // Fallback: 傳回基本結構避免當機
        return {
            content: `  ▌ 分析報告 (Fallback)\n\n${ytData.title}\n\n系統暫時無法生成完整分析。`,
            image_decision: { type: "news", keyword: ytData.title }
        };
    }
}

// 3. 自動分發 (Make Integration)
async function dispatchToSocial(payload) {
    if (!process.env.MAKE_WEBHOOK_URL) return;
    try {
        await axios.post(process.env.MAKE_WEBHOOK_URL, payload);
        console.log(`[Make] Webhook 發送成功`);
    } catch (e) {
        console.error(`[Make Error] ${e.message}`);
    }
}

// ==========================================
// ⏰ 任務 1A: 05:00 娛樂熱門榜 (Legacy)
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
// ⏰ 任務 1B: 05:10 頻道監控 (Legacy with Buffer)
// ==========================================
schedule.scheduleJob('10 21 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    
    const channels = process.env.MONITOR_CHANNELS ? process.env.MONITOR_CHANNELS.split(',') : [];
    if (channels.length === 0) return;

    console.log(`⏰ [05:10 Job] 啟動頻道監控 (${channels.length} 位)...`);
    
    // 使用 for...of 迴圈確保 await 休息生效 (分艙防水)
    for (let i = 0; i < channels.length; i++) {
        const channelId = channels[i].trim();
        if (!channelId) continue;

        try {
            const newVideos = await checkChannelLatestVideo(channelId);
            
            if (newVideos && newVideos.length > 0) {
                console.log(`[Monitor] ${channelId} 發現 ${newVideos.length} 新片`);
                
                for (const video of newVideos) {
                    const news = await searchGoogle(video.title);
                    const inference = await generateInference(video, news); // 舊的簡易推論
                    await bot.sendMessage(chatId, `🚨 **大神發片**\n${inference}\n📺 ${video.url}`);
                    
                    // 同一位大神多支影片間隔 60秒
                    if (newVideos.length > 1) await delay(60000); 
                }
            }
        } catch (err) {
            console.error(`[Monitor Error] ${channelId}:`, err.message);
        }

        // 大神與大神之間休息 3 分鐘
        if (i < channels.length - 1) { 
            console.log(`[Buffer] 休息 3 分鐘...`);
            await delay(180000); 
        }
    }
    console.log(`✅ [05:10 Job] 監控結束`);
});

// ==========================================
// ⏰ 任務 2: 06:00 全球熱搜 (RSS Fix - 解決幽靈名單)
// ==========================================
schedule.scheduleJob('0 22 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [06:00 Job] 啟動全球熱搜 (RSS Mode)...');

    const targets = [
        { geo: 'US', flag: '🇺🇸', name: '美國' },
        { geo: 'GB', flag: '🇬🇧', name: '英國' },
        { geo: 'JP', flag: '🇯🇵', name: '日本' } // 日本 RSS 需確認支援度，通常可行
    ];

    let trendReport = "🌎 **昨夜今晨全球 Google 熱搜**\n(點擊指令可深入偵查)\n";

    try {
        for (const t of targets) {
            // 使用 RSS Parser 取代舊的 unstable API
            const rssUrl = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${t.geo}`;
            const feed = await parser.parseURL(rssUrl);
            const top3 = feed.items.slice(0, 3); // 只取前 3

            trendReport += `\n${t.flag} **${t.name}**\n`;
            
            top3.forEach((item, i) => {
                // 製作可點擊指令：將空白轉為底線，移除特殊符號
                const safeKeyword = item.title.replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fa5_]/g, '');
                // item.approx_traffic 在 RSS 中通常在 contentSnippet 或其他欄位，這裡簡化顯示
                trendReport += `${i+1}. ${item.title}\n   👉 /search_${safeKeyword}_1\n`;
            });
        }
        await bot.sendMessage(chatId, trendReport);
    } catch (e) {
        console.error("RSS 熱搜錯誤:", e.message);
        await bot.sendMessage(chatId, "⚠️ 熱搜讀取部分失敗，請檢查 Log");
    }
});

// ==========================================
// ⏰ 任務 3: 08:00 每日議題 (Big 2.5 序列化 & 決策)
// ==========================================
schedule.scheduleJob('0 0 * * *', async function(){
    const chatId = process.env.MY_CHAT_ID;
    if (!chatId) return;
    console.log('⏰ [08:00 Job] 啟動每日議題 (Sequence Mode)...');

    const topics = (process.env.DAILY_TOPIC || '').split(/[,，]/).map(t => t.trim()).filter(t => t);
    
    // 改用 for...of 實現真正的序列化與錯誤隔離
    for (const topic of topics) {
        try {
            console.log(`\n=== [Daily Topic] 處理: ${topic} ===`);
            
            // 1. 搜尋素材
            const ytData = await searchYouTube(topic, 1);
            if (!ytData) {
                console.log(`找不到 ${topic} 相關影片，跳過`);
                continue;
            }
            const newsData = await searchGoogle(ytData.title);

            // 2. Gemini V2 分析 (取得 JSON)
            const analysis = await generateAnalysisV2(ytData, newsData);

            // 3. 智能搜圖 (Router)
            const imageUrl = await fetchSmartImage(analysis.image_decision.keyword, analysis.image_decision.type);

            // 4. 發送 Telegram
            if (imageUrl) {
                await bot.sendPhoto(chatId, imageUrl, { caption: analysis.content.substring(0, 1000) });
            } else {
                await bot.sendMessage(chatId, analysis.content);
            }

            // 5. 自動化分發 (Make)
            const payload = {
                topic: topic,
                title: ytData.title,
                content: analysis.content,
                imageUrl: imageUrl || '',
                url: ytData.url,
                timestamp: new Date().toISOString()
            };
            await dispatchToSocial(payload);

        } catch (error) {
            console.error(`❌ 議題 ${topic} 處理失敗:`, error.message);
            // 單一議題失敗，不影響下一個
        }

        // 序列化緩衝：確保議題之間間隔 10 分鐘 (600,000 ms)
        // 確保 Render 資源釋放，且讓 Telegram 訊息發送節奏舒適
        console.log(`⏳ 冷卻中...等待 10 分鐘...`);
        await delay(600000); 
    }
    
    console.log(`✅ [08:00 Job] 每日議題匯報結束`);
});

// ==========================================
// 👤 指令處理 (保留 Big 1 手動功能)
// ==========================================
bot.onText(/\/search(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    // 支援 /search_關鍵字_天數 格式
    let rawInput = match[1].trim().replace(/_/g, ' '); 
    const inputParts = rawInput.split(/\s+/);
    let days = 3; // 預設 3 天
    let keyword = rawInput;
    
    // 檢查最後一個參數是否為數字 (天數)
    if (inputParts.length > 1 && /^\d+$/.test(inputParts[inputParts.length - 1])) {
        days = parseInt(inputParts.pop());
        keyword = inputParts.join(' ');
    }
    
    await bot.sendMessage(chatId, `🔍 [手動偵查] ${keyword} (過去 ${days} 天)...`);
    
    try {
        const ytData = await searchYouTube(keyword, days);
        if (!ytData) return bot.sendMessage(chatId, `❌ 找不到相關影片`);
        
        const newsData = await searchGoogle(ytData.title);
        // 使用新版 V2 分析，享受圖文並茂
        const analysis = await generateAnalysisV2(ytData, newsData);
        const imageUrl = await fetchSmartImage(analysis.image_decision.keyword, analysis.image_decision.type);
        
        if (imageUrl) {
            await bot.sendPhoto(chatId, imageUrl, { caption: analysis.content.substring(0, 1000) });
        } else {
            await bot.sendMessage(chatId, analysis.content);
        }
    } catch (e) {
        console.error(e.message);
        await bot.sendMessage(chatId, "偵查發生錯誤");
    }
});

// Big 1 聊天功能 (保持不變)
const SYSTEM_PROMPT_CHAT = `你是一位社群編輯。請將內容改寫為 FB 繁體中文貼文，標題用 "  ▌ " 開頭，不使用粗體，段落空一行。`;
bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    if (!msg.text) return;
    
    try {
        // 簡單聊天不做圖，純文字回應
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`${SYSTEM_PROMPT_CHAT}\n\n${msg.text}`);
        await bot.sendMessage(chatId, result.response.text());
    } catch (e) { console.error(e.message); }
});

app.get('/', (req, res) => res.send('Info Commander Big 2 Online'));
app.listen(port, () => console.log(`Server running on port ${port}`));