/**
 * ==============================================================================
 * 🛠️ Info Commander Services (Final Integration)
 * ==============================================================================
 * [Feature]     Big 1(Read) + Big 2(Schedule/RSS) + Big 3(Gate/Make)
 * [Model]       Gemini 3 Flash Preview (Locked)
 * [Update]      Ensure URL is attached for both News & Concept types
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse');
const Parser = require('rss-parser');

// 基礎設定
const parser = new Parser({ timeout: 10000 });
const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_NEW || process.env.GEMINI_API_KEY);

// ⚠️⚠️⚠️ 嚴禁更動：指定使用 gemini-3-flash-preview 模型 ⚠️⚠️⚠️
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getDateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
};

// ============================================================================
// 📝 Prompt 模組設定 (雙軌策略：新聞 vs 散文)
// ============================================================================
const GATE_PROMPT_TEMPLATE = `
你是一位高效的知識管理與文章摘要專家。
請閱讀下方的【原始內容】，先判斷其屬性，再決定撰寫策略。

【原始內容】：
{{content}}

【第一步：屬性判斷】
請分析內容是屬於「時事新聞/資訊類」還是「概念/知識/散文類」。

【第二步：撰寫策略】

👉 情況 A：如果是【時事新聞/資訊類】
請嚴格遵守「新聞倒金字塔」風格：
1. 標題格式：以 "  ▌ " 開頭 (注意前後有空格)，標題需吸睛。
2. 寫作結構：結論與重點在前，細節在後。
3. 排版風格：段落間務必「空一行」，複雜數據請用「列點式」。
4. 引用來源：文章「最後一段」必須統整列出參考來源。
5. 字數：400~600 字。

👉 情況 B：如果是【概念/知識/散文類】
請採用「深度概念擴寫」風格：
1. 核心結構：定義 + 對比/類比 + 實例應用。
2. 寫作技巧：
   - 定義：清楚說明核心概念。
   - 對比/類比：使用具體形象的比喻或與常見認知做對比 (例如：貢獻日記 vs 感恩日記)。
   - 實例：結合原文例子轉化為行動建議。
3. 行文風格：
   - 流暢敘事 (Narrative Flow)，不要使用生硬的「標題：內容」格式。
   - 將小標題概念融入段落第一句，像在說故事。
   - 段落間務必「空一行」。
4. 引用來源：雖然是散文，若原文有明確出處，請在文章「最後一段」簡單標註來源。

【第三步：輸出格式 (Strict JSON)】
請輸出純 JSON 格式，不要 Markdown：
{
  "content": "撰寫好的完整文章內容 (含標題、Emoji)",
  "image_decision": {
    "type": "concept", 
    "keyword": "請提供一個英文關鍵字用於搜尋圖片"
  }
}
`;

// ============================================================================
// 🔍 A. 圖片搜尋 & 基礎工具
// ============================================================================
async function fetchSmartImage(keyword, type) {
    try {
        if (process.env.UNSPLASH_ACCESS_KEY) {
            const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`);
            if (res.data.results?.[0]) return res.data.results[0].urls.regular;
        }
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`);
        if (res.data.items?.[0]) return res.data.items[0].link;
        return null;
    } catch (e) { return null; }
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

// ============================================================================
// 📖 B. 閱讀能力 (Process URL & PDF)
// ============================================================================
async function processUrl(url) { 
    try {
        console.log(`[Service] Reading: ${url}`);
        const res = await axios.get(url, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } 
        });
        const rawHtml = res.data.substring(0, 50000); 
        const textOnly = rawHtml.replace(/<[^>]*>?/gm, '');
        return textOnly;
    } catch (e) { return null; }
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
// ✍️ C. Gate 改寫 (核心功能：讀取 -> 思考 -> 撰寫)
// ============================================================================
async function processGateMessage(rawText) {
    try {
        let contentToProcess = rawText;
        let sourceUrl = "";

        // 1. 網址偵測與閱讀 (這裡會抓出網址，保證後續 Make 會有連結)
        const urlMatch = rawText.match(/(https?:\/\/[^\s]+)/g);
        if (urlMatch && urlMatch[0]) {
            sourceUrl = urlMatch[0];
            console.log(`[Gate] 發現網址，啟動閱讀程序...`);
            const readContent = await processUrl(sourceUrl);
            if (readContent) {
                contentToProcess = `(來源網址: ${sourceUrl})\n\n網頁內容:\n${readContent}`;
            }
        }

        // 2. 替換 Prompt 變數並呼叫 Gemini
        const finalPrompt = GATE_PROMPT_TEMPLATE.replace('{{content}}', contentToProcess);
        const result = await model.generateContent(finalPrompt);

        // 3. 解析 JSON
        let jsonStr = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(jsonStr);
        const img = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);

        return { content: json.content, imageUrl: img, sourceUrl: sourceUrl };

    } catch (e) { 
        console.log(`[Gate Error] ${e.message}`);
        return null; 
    }
}

// ============================================================================
// 🚀 D. Make 發送器 (Fire and Forget)
// ============================================================================
async function dispatchToMake(payload) {
    const makeUrl = process.env.MAKE_WEBHOOK_URL;
    if (!makeUrl) { console.log("❌ [Make Error] 未設定 MAKE_WEBHOOK_URL"); return; }

    console.log(`🚀 [Dispatch] 正在發送至 Make (${payload.type})...`);
    axios.post(makeUrl, payload)
        .then(() => console.log(`✅ [Make Success] 資料已送達 Make`))
        .catch(err => console.log(`❌ [Make Failed] ${err.message}`));
}

// ============================================================================
// 🤖 E. 自動化分析 & 排程邏輯 (Big 2 功能回歸)
// ============================================================================
async function generateAnalysisV2(ytData, newsData) {
    try {
        const PROMPT_RULES = `
        【文章撰寫嚴格要求】
        1. **標題格式**：必須以 "  ▌ " 開頭 (注意前後有空格)，標題需吸睛。
        2. **寫作結構**：採用「倒金字塔」風格。
        3. **排版風格**：段落間務必「空一行」。
        4. **字數限制**：控制在 400~600 字之間。
        5. **結尾要求**：文章的「最後一段」必須統整列出參考來源。
        `;

        const result = await model.generateContent(`
        你是一個全球情報分析師。請針對以下素材進行分析：
        【YouTube 標題】：${ytData.title}
        【相關新聞】：${newsData}

        請輸出一個 **純 JSON 格式** 的回應，包含以下兩個欄位：
        1. "content": 根據以下規則撰寫一篇繁體中文說明文章：${PROMPT_RULES}
        2. "image_decision": {"type":"news", "keyword":"${ytData.title} (keywords in English)"}
        `);
        
        return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (e) { return null; }
}

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
                    if (callback) {
                        await callback({
                            keyword: keyword,
                            content: analysis.content,
                            imageUrl: analysis.image_decision?.keyword 
                        });
                    } else {
                        await dispatchToMake({ type: 'daily_analysis', data: analysis, keyword: keyword });
                    }
                }
            }
            await delay(5000); 
        } catch (err) { console.error(`處理 ${keyword} 錯誤:`, err.message); }
    }
}

// 🤖 YouTube 深度監控
async function checkChannelLatestVideo(channelId) {
    try {
        const searchRes = await youtube.search.list({ part: 'snippet', channelId: channelId, order: 'date', type: 'video', publishedAfter: getDateDaysAgo(2), maxResults: 1 });
        const videoItem = searchRes.data.items?.[0];
        if (!videoItem) return null; 

        const videoId = videoItem.id.videoId;
        const detailRes = await youtube.videos.list({ part: 'snippet,statistics,topicDetails', id: videoId });
        const detail = detailRes.data.items?.[0];
        if (!detail) return null; 

        const aiPrompt = `
        你是一位客觀的資訊整理員。請閱讀這部 YouTube 影片的原始資料，並轉換為繁體中文介紹。
        【原始資料】：標題: ${detail.snippet.title} \n 說明欄: ${detail.snippet.description}
        【處理原則】：去雜訊、忠於原意、200~300字摘要。
        `;
        const aiResult = await model.generateContent(aiPrompt);

        return {
            title: detail.snippet.title,
            channelTitle: detail.snippet.channelTitle,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            aiAnalysis: aiResult.response.text(), 
            viewCount: detail.statistics.viewCount,
        };
    } catch (e) { return null; }
}

async function getMostPopularVideos(regionCode) {
    try {
        const res = await youtube.videos.list({ part: 'snippet', chart: 'mostPopular', regionCode: regionCode, maxResults: 5 });
        return res.data.items.map(v => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}` }));
    } catch (e) { return []; }
}

// 🌍 RSS 聚合
async function fetchRSSGroup(sources, limit = 10) {
    try {
        const tasks = sources.map(async (src) => {
            try {
                const feed = await parser.parseURL(src.url);
                return feed.items.slice(0, limit).map(item => ({ title: item.title, link: item.link, sourceName: src.name }));
            } catch (e) { return []; }
        });
        const results = await Promise.all(tasks);
        return results.flat();
    } catch (e) { return []; }
}

async function fetchAllRSS(rssList) { return await fetchRSSGroup(rssList, 5); }
async function getUSNews() { return await fetchRSSGroup([{ name: 'NY Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' }, { name: 'Wired', url: 'https://www.wired.com/feed/rss' }], 10); }
async function getJPNews() { return await fetchRSSGroup([{ name: 'Japan Times', url: 'https://www.japantimes.co.jp/feed' }, { name: 'Japan Today', url: 'https://japantoday.com/feed' }], 10); }
async function getGBNews() { return await fetchRSSGroup([{ name: 'BBC', url: 'http://feeds.bbci.co.uk/news/rss.xml' }], 10); }
async function getFRNews() { return await fetchRSSGroup([{ name: 'France 24', url: 'https://www.france24.com/en/rss' }], 10); }

module.exports = {
    processGateMessage, processPDF, processUrl, dispatchToMake,
    checkChannelLatestVideo, getMostPopularVideos, startDailyRoutine, 
    fetchAllRSS, getUSNews, getJPNews, getGBNews, getFRNews
};