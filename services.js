/**
 * ==============================================================================
 * 🛠️ Info Commander Services
 * ==============================================================================
 * [Version]     1227_Update_Slot1_2_RSS_Internal_Logic
 * [Feature]     Internal Execution / Gem-3-Preview / Strict Prompt
 * ==============================================================================
 */

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PdfParse = require('pdf-parse');
const Parser = require('rss-parser');

// ✅ 設定：使用標準連線 (無偽裝表頭)，設定 10 秒超時保護
const parser = new Parser({
    timeout: 10000 
});

const googleKey = process.env.GOOGLE_SEARCH_KEY || process.env.GOOGLE_CLOUD_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: googleKey });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ 模型設定 (依照您的指定：gemini-3-flash-preview)
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const getDateDaysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
// 🧠 D. 自動化分析 (🔥 Prompt 升級與嚴格格式化)
// ============================================================================
async function generateAnalysisV2(ytData, newsData) {
    try {
        // 定義您的嚴格格式要求
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
// 🤖 E. 自動化爬蟲 (維持原樣)
// ============================================================================

// [時段一] 熱門影片
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

// [時段二] 大神發片
async function checkChannelLatestVideo(channelId) {
    try {
        const searchRes = await youtube.search.list({ 
            part: 'snippet', 
            channelId: channelId, 
            order: 'date', 
            type: 'video', 
            publishedAfter: getDateDaysAgo(1), 
            maxResults: 1 
        });

        const videoItem = searchRes.data.items?.[0];
        if (!videoItem) return null; 

        await delay(1000);

        const videoId = videoItem.id.videoId;
        const detailRes = await youtube.videos.list({
            part: 'snippet,contentDetails',
            id: videoId
        });

        const detail = detailRes.data.items?.[0]?.snippet;
        if (!detail) return null; 

        const fullDesc = detail.description || "";
        let finalDesc = "";

        if (fullDesc.length > 50) {
            finalDesc = fullDesc; 
        }

        return {
            title: detail.title,
            channelTitle: detail.channelTitle,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            description: finalDesc,
            publishedAt: detail.publishedAt
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

// 時段四：Google 熱搜 (核武版：使用 SerpApi 穿透封鎖)
async function getGlobalTrends(geo) {
    try {
        // 如果沒有設定 API Key，就回傳空 (避免報錯)
        if (!process.env.SERPAPI_KEY) {
            console.log("[SerpApi] 尚未設定 SERPAPI_KEY");
            return [];
        }

        console.log(`[Service] 使用 SerpApi 抓取 ${geo} 熱搜...`);
        
        // 使用 axios 呼叫 SerpApi (不需安裝新套件)
        const url = `https://serpapi.com/search.json?engine=google_trends_trending_now&frequency=daily&geo=${geo}&api_key=${process.env.SERPAPI_KEY}`;
        
        const res = await axios.get(url, { timeout: 20000 }); 

        // SerpApi 的回傳結構解析
        if (res.data && res.data.trending_searches) {
            return res.data.trending_searches.slice(0, 10).map(item => ({ 
                title: item.query 
            }));
        }
        
        return [];
    } catch (e) { 
        console.log(`[SerpApi Error] ${geo}: ${e.message}`);
        return []; 
    }
}
async function dispatchToMake(payload) {
    if (process.env.MAKE_WEBHOOK_URL) await axios.post(process.env.MAKE_WEBHOOK_URL, payload).catch(e=>{});
}

// ============================================================================
// 📡 F. RSS 讀取 (維持原樣)
// ============================================================================
async function fetchRSS(feedUrl, sourceName) {
    try {
        const feed = await parser.parseURL(feedUrl);
        return feed.items.slice(0, 5).map(item => ({
            title: `[${sourceName}] ${item.title}`,
            link: item.link,
            pubDate: item.pubDate
        }));
    } catch (e) {
        console.log(`[RSS Warning] ${sourceName} read failed: ${e.message}`);
        return [{ title: `⚠️ [${sourceName}] 讀取失敗`, link: '#', pubDate: new Date().toISOString() }];
    }
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
// 🚀 G. 內部邏輯執行官 (Fire-and-Forget 核心)
// ============================================================================
/**
 * 這是 service 內部的「主控台」。
 * 它不依賴 Make 的流程，而是自己執行：搜尋 -> 分析 -> (最後才把結果丟給 Make/DB)
 */
async function startDailyRoutine(keywords = []) {
    console.log("========== [Internal Service] 開始執行內部任務 ==========");

    // 1. 決定目標 (若無傳入，使用預設)
    const targets = keywords.length > 0 ? keywords : ["AI趨勢", "自動化技術"];

    for (const keyword of targets) {
        try {
            console.log(`>>> 正在處理關鍵字: ${keyword}`);
            
            // 2. 內部執行搜尋 (不依賴外部傳入資料)
            const ytResult = await searchYouTube(keyword);
            const newsResult = await searchGoogle(keyword);

            if (ytResult) {
                // 3. 呼叫 AI 生成 (這裡使用了上方更新過的 Prompt)
                const analysis = await generateAnalysisV2(ytResult, newsResult);

                if (analysis) {
                    console.log(`[成功產出] ${keyword} 的文章`);
                    
                    // 4. 只將「最終結果」發送出去 (Fire-and-Forget 的最後一步)
                    await dispatchToMake({
                        type: 'daily_analysis',
                        data: analysis,
                        keyword: keyword
                    });
                }
            } else {
                console.log(`[跳過] ${keyword} 找不到相關 YouTube 資料`);
            }
            
            // 5. 安全延遲
            await delay(5000);

        } catch (err) {
            console.error(`處理 ${keyword} 時發生錯誤:`, err.message);
        }
    }
    
    console.log("========== [Internal Service] 任務執行完畢 ==========");
}
// [新增] 懶人包：直接回傳排版好的熱搜文字 (防呆版)
async function getQuickTrends(geo) { const t = await getGlobalTrends(geo); return t.length ? t.map((x,i)=>`${i+1}. ${x.title}`).join('\n') : "無資料"; }
module.exports = {
    processGateMessage, processPDF, processUrl, generateAnalysisV2,
    searchYouTube, searchGoogle, getGlobalTrends, getMostPopularVideos, checkChannelLatestVideo,
    fetchSmartImage, dispatchToMake,
    fetchRSS, fetchAllRSS,
    startDailyRoutine,  // <--- 這裡記得加逗號
    getQuickTrends      // <--- 這是您要新增的！
};