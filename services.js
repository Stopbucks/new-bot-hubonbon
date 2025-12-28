/**
 * ==============================================================================
 * 🛠️ Info Commander Services
 * ==============================================================================
 * [Version]     1228_Final_RSS_Global_Edition
 * [Feature]     RSS Aggregator (US/JP/GB/FR) / YouTube Reality Prompt / Split Schedule
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse');
const Parser = require('rss-parser');

// ✅ 設定：使用標準連線，設定 10 秒超時保護
const parser = new Parser({ timeout: 10000 });

const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
// 優先使用新設定的 API Key，若無則回退舊設定
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_NEW || process.env.GEMINI_API_KEY);

// ✅ 模型設定：使用 gemini-3-flash-preview 版本
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getDateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
};

// ============================================================================
// 🔍 A. 圖片搜尋 (維持原樣)
// ============================================================================
async function fetchSmartImage(keyword, type) {
    try {
        if (type === 'concept' && process.env.UNSPLASH_ACCESS_KEY) {
            const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`);
            if (res.data.results?.[0]) return res.data.results[0].urls.regular;
        }
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`);
        if (res.data.items?.[0]) return res.data.items[0].link;
        return null;
    } catch (e) { return null; }
}

// ============================================================================
// 📖 B. 閱讀能力 PDF & Web (維持原樣)
// ============================================================================
async function processUrl(url) { 
    try {
        console.log(`[Service] Reading: ${url}`);
        const res = await axios.get(url, { timeout: 10000 });
        const rawHtml = res.data.substring(0, 40000); 
        const result = await model.generateContent(`請忽略HTML標籤，摘要這篇網頁文章(繁體中文)，若是新聞請抓出重點：\n${rawHtml}`);
        return result.response.text();
    } catch (e) { return "⚠️ 無法讀取網頁 (可能被阻擋或連線逾時)。"; }
}

async function processPDF(fileUrl) {
    try {
        console.log(`[Service] Reading PDF...`);
        const res = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const data = await PdfParse(res.data);
        const text = data.text.substring(0, 20000);
        const result = await model.generateContent(`請摘要這份 PDF 文件(繁體中文)：\n${text}`);
        return result.response.text();
    } catch (e) { return "❌ PDF 讀取失敗"; }
}

// ============================================================================
// ✍️ C. Gate 改寫 (維持原樣)
// ============================================================================
async function processGateMessage(rawText) {
    try {
        const result = await model.generateContent(`
        改寫為 FB 貼文 (純JSON):
        {"content": "含標題(  ▌  ), Emoji, Hashtag, 150字內, 語氣吸睛", "image_decision": {"type":"news/concept", "keyword":"en_keyword"}}
        \n內容: ${rawText}`);
        let jsonStr = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(jsonStr);
        const img = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);
        return { content: json.content, imageUrl: img };
    } catch (e) { return { content: "⚠️ AI 生成失敗，請重試", imageUrl: "" }; }
}

// ============================================================================
// 🧠 D. 自動化分析 (關鍵字議題分析)
// ============================================================================
async function generateAnalysisV2(ytData, newsData) {
    try {
        const PROMPT_RULES = `
        【文章撰寫嚴格要求】
        1. **標題格式**：必須以 "  ▌ " 開頭 (注意前後有空格)，標題需吸睛。
        2. **寫作結構**：採用「倒金字塔」風格 (最重要的結論與重點寫在第一段)。
        3. **排版風格**：
           - 段落與段落之間務必「空一行」。
           - 語氣專業但易讀，遇到複雜概念或數據時，請改為「列點式」呈現 (Facebook 風格)。
        4. **字數限制**：控制在 400~600 字之間。
        5. **結尾要求**：文章的「最後一段」必須統整列出參考來源。
        `;

        const result = await model.generateContent(`
        你是一個全球情報分析師。請針對以下素材進行分析：
        【YouTube 標題】：${ytData.title}
        【相關新聞】：${newsData}

        請輸出一個 **純 JSON 格式** 的回應 (不要 Markdown code block)，包含以下兩個欄位：
        
        1. "content": 請根據以下規則撰寫一篇繁體中文說明文章：
           ${PROMPT_RULES}
        
        2. "image_decision": {"type":"news", "keyword":"${ytData.title} (keywords in English)"}
        `);
        
        return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (e) { 
        console.log("[Analysis Error]", e.message);
        return null;
    }
}

// ============================================================================
// 🤖 E. 自動化爬蟲 (YouTube 深度解析版)
// ============================================================================

// [時段一] 熱門影片 (維持原樣)
async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ 
            part: 'snippet', 
            chart: 'mostPopular', 
            regionCode: regionCode, 
            maxResults: 5 
        });
        return res.data.items.map(v => ({ 
            title: v.snippet.title, 
            url: `https://www.youtube.com/watch?v=${v.id}` 
        }));
    } catch (e) { 
        console.log(`[Youtube Error] Pop Video (${regionCode}): ${e.message}`);
        return []; 
    }
}

// 🔥 [重點功能] 大神發片監控 + 真實系 AI 解讀
async function checkChannelLatestVideo(channelId) {
    try {
        // 1. 找出最新的一支影片
        const searchRes = await youtube.search.list({ 
            part: 'snippet', 
            channelId: channelId, 
            order: 'date', 
            type: 'video', 
            publishedAfter: getDateDaysAgo(2), 
            maxResults: 1 
        });

        const videoItem = searchRes.data.items?.[0];
        if (!videoItem) return null; 

        // 2. 二次查詢：獲取詳細 Metadata (Tag, ViewCount, Topic)
        const videoId = videoItem.id.videoId;
        const detailRes = await youtube.videos.list({
            part: 'snippet,statistics,topicDetails',
            id: videoId
        });

        const detail = detailRes.data.items?.[0];
        if (!detail) return null; 

        const snippet = detail.snippet;
        const stats = detail.statistics;

        // 3. 準備素材給 AI (包含標籤，協助判斷內容)
        const rawInfo = `
        標題: ${snippet.title}
        頻道: ${snippet.channelTitle}
        說明欄: ${snippet.description}
        標籤: ${snippet.tags ? snippet.tags.join(', ') : '無'}
        `;

        // 4. 呼叫 Gemini (真實系 Prompt)
        console.log(`[Service] 正在解析 ${snippet.channelTitle} 的真實資訊...`);
        
        const aiPrompt = `
        你是一位客觀的資訊整理員。請閱讀這部 YouTube 影片的原始資料（Metadata），並轉換為繁體中文介紹。

        【原始資料】：
        ${rawInfo}

        【處理原則】：
        1. **去雜訊**：請忽略「請訂閱」、「開啟小鈴鐺」、「追蹤IG」、「業配連結」等無效資訊。
        2. **忠於原意**：只根據標題、說明欄、標籤進行整理。**嚴禁無中生有的過度推論**。
        3. **適度潤飾**：僅允許 20%~40% 的語意擴充，目的是將破碎的關鍵字串連成通順語句。
        4. **資訊量判斷**：
           - 若去除雜訊後資訊極少（例如只有標題吸睛，說明欄空白），請直接輸出：「⚠️ 此影片資訊量貧乏，僅提供標題參考。」
           - 若有具體內容，請整理為 200~300 字的繁體中文摘要。
        5. **標註**：若必須根據「標籤 (Tags)」來推測標題未提及的細節，請在該句結尾加上「(AI推論)」。

        【輸出格式】：
        直接輸出整理後的文字內容即可，不需 Markdown 標題。
        `;

        const aiResult = await model.generateContent(aiPrompt);
        const aiArticle = aiResult.response.text();

        return {
            title: snippet.title,
            channelTitle: snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            aiAnalysis: aiArticle, // AI 整理後的真實資訊
            viewCount: stats.viewCount,
            tags: snippet.tags ? snippet.tags.slice(0, 5).join(', ') : ""
        };

    } catch (e) { 
        console.log(`[Youtube Error] Channel Monitor: ${e.message}`);
        return null; 
    }
}

async function searchYouTube(keyword) {
    try {
        const res = await youtube.search.list({ part: 'snippet', q: keyword, order: 'viewCount', type: 'video', publishedAfter: getDateDaysAgo(2), maxResults: 1 });
        return res.data.items?.[0] ? { title: res.data.items[0].snippet.title, url: `https://www.youtube.com/watch?v=${res.data.items[0].id.videoId}` } : null;
    } catch (e) { return null; }
}

async function searchGoogle(q) {
    try {
        const res = await axios.get('https://www.googleapis.com/customsearch/v1', { params: { key: googleKey, cx: process.env.SEARCH_ENGINE_ID, q, num: 3 } });
        return res.data.items ? res.data.items.map(i => i.snippet).join('\n') : "";
    } catch (e) { return ""; }
}

async function dispatchToMake(payload) {
    if (process.env.MAKE_WEBHOOK_URL) await axios.post(process.env.MAKE_WEBHOOK_URL, payload).catch(e=>{});
}

// F. RSS 讀取 (Web Dashboard API 使用)
async function fetchRSS(feedUrl, sourceName) {
    try {
        const feed = await parser.parseURL(feedUrl);
        return feed.items.slice(0, 5).map(item => ({
            title: `[${sourceName}] ${item.title}`,
            link: item.link,
            pubDate: item.pubDate
        }));
    } catch (e) { return [{ title: `⚠️ [${sourceName}] 讀取失敗`, link: '#', pubDate: new Date().toISOString() }]; }
}

async function fetchAllRSS(rssList) {
    let allItems = [];
    for (const rss of rssList) {
        const items = await fetchRSS(rss.url, rss.name);
        allItems = allItems.concat(items);
        await delay(1500);
    }
    return allItems; 
}

// ============================================================================
// 🌍 全球情報 RSS 聚合區 (取代 SerpApi / Google Trends)
// ============================================================================

// 🛠️ 內部共用工具：RSS 抓取、混合排序、錯誤處理
async function fetchRSSGroup(sources) {
    try {
        // 使用 Promise.all 平行發送請求，降低 Render 等待時間
        const tasks = sources.map(async (src) => {
            try {
                const feed = await parser.parseURL(src.url);
                // 每個來源取前 4 則
                return feed.items.slice(0, 4).map(item => ({
                    title: item.title,
                    link: item.link,
                    sourceName: src.name
                }));
            } catch (e) {
                console.log(`[RSS Warning] ${src.name} 讀取失敗: ${e.message}`);
                return [];
            }
        });

        const results = await Promise.all(tasks);
        const flatList = results.flat();
        
        if (flatList.length === 0) return [];

        return flatList;
    } catch (e) {
        console.error(`[Aggregator Error] RSS 聚合失敗: ${e.message}`);
        return [];
    }
}

// 🇺🇸 美國區塊
async function getUSNews() {
    console.log('[Service] 抓取 US RSS...');
    return await fetchRSSGroup([
        { name: 'NY Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
        { name: 'Wired', url: 'https://www.wired.com/feed/rss' }
    ]);
}

// 🇯🇵 日本區塊
async function getJPNews() {
    console.log('[Service] 抓取 JP RSS...');
    return await fetchRSSGroup([
        { name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed' },
        { name: 'Japan Today', url: 'https://japantoday.com/feed' }
    ]);
}

// 🇬🇧 英國區塊
async function getGBNews() {
    console.log('[Service] 抓取 GB RSS...');
    return await fetchRSSGroup([
        { name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' }
    ]);
}

// 🇫🇷 法國區塊
async function getFRNews() {
    console.log('[Service] 抓取 FR RSS...');
    return await fetchRSSGroup([
        { name: 'France 24', url: 'https://www.france24.com/en/rss' }
    ]);
}

// ============================================================================
// 🚀 G. 內部邏輯執行官 (Fire-and-Forget + Callback)
// ============================================================================
async function startDailyRoutine(keywords = [], callback = null) {
    console.log("========== [Internal Service] 開始執行 (分流模式) ==========");

    const targets = keywords.length > 0 ? keywords : ["AI趨勢"];

    for (const keyword of targets) {
        if(!keyword) continue;
        try {
            console.log(`>>> 正在處理關鍵字: ${keyword}`);
            
            const ytResult = await searchYouTube(keyword);
            const newsResult = await searchGoogle(keyword);

            if (ytResult) {
                const analysis = await generateAnalysisV2(ytResult, newsResult);

                if (analysis) {
                    console.log(`[成功產出] ${keyword}`);
                    
                    if (callback) {
                        await callback({
                            keyword: keyword,
                            content: analysis.content,
                            imageUrl: analysis.image_decision?.keyword 
                        });
                    } else {
                        await dispatchToMake({
                            type: 'daily_analysis',
                            data: analysis,
                            keyword: keyword
                        });
                    }
                }
            } else {
                console.log(`[跳過] ${keyword} 找不到相關 YouTube 資料`);
            }
            await delay(5000); 

        } catch (err) {
            console.error(`處理 ${keyword} 時發生錯誤:`, err.message);
        }
    }
    console.log("========== [Internal Service] 任務執行完畢 ==========");
}

// 懶人包：直接回傳排版好的熱搜文字 (已用 RSS 取代 Google Trends)
async function getQuickTrends(geo) { 
    return "已轉移至 RSS 分流架構"; 
}

module.exports = {
    processGateMessage, processPDF, processUrl, generateAnalysisV2,
    searchYouTube, searchGoogle, getMostPopularVideos, checkChannelLatestVideo,
    fetchSmartImage, dispatchToMake,
    fetchRSS, fetchAllRSS,
    startDailyRoutine,
    getQuickTrends,
    // 👇 RSS 專屬函式
    getUSNews, getJPNews, getGBNews, getFRNews
};