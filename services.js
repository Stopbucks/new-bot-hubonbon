/**
 * ==============================================================================
 * 🛠️ Info Commander Services (Make Integration Edition)
 * ==============================================================================
 * [Feature]     URL Reading -> AI Rewrite -> Make Dispatch
 * [Model]       Gemini 3 Flash Preview (Locked)
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

// ⚠️⚠️⚠️ 嚴禁更動：指定使用 gemini-3-flash-preview 模型 (依據 User 截圖要求) ⚠️⚠️⚠️
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
// 🔍 A. 圖片搜尋
// ============================================================================
async function fetchSmartImage(keyword, type) {
    try {
        // 若有 Unsplash 設定優先使用
        if (process.env.UNSPLASH_ACCESS_KEY) {
            const res = await axios.get(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(keyword)}&per_page=1&client_id=${process.env.UNSPLASH_ACCESS_KEY}`);
            if (res.data.results?.[0]) return res.data.results[0].urls.regular;
        }
        // 備用：Google Custom Search
        const res = await axios.get(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&cx=${process.env.SEARCH_ENGINE_ID}&key=${googleKey}&searchType=image&num=1`);
        if (res.data.items?.[0]) return res.data.items[0].link;
        return null;
    } catch (e) { return null; }
}

// ============================================================================
// 📖 B. 閱讀能力 (Process URL & PDF)
// ============================================================================
async function processUrl(url) { 
    try {
        console.log(`[Service] Reading: ${url}`);
        // 簡單偽裝 User Agent 避免被部分網站擋
        const res = await axios.get(url, { 
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } 
        });
        const rawHtml = res.data.substring(0, 50000); // 取前 5萬字避免 Token 爆掉
        // 快速清洗 HTML 標籤
        const textOnly = rawHtml.replace(/<[^>]*>?/gm, '');
        return textOnly;
    } catch (e) { 
        console.log(`[Read Error] ${e.message}`);
        return null; 
    }
}

async function processPDF(fileUrl) {
    try {
        console.log(`[Service] Reading PDF...`);
        const res = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const data = await PdfParse(res.data);
        return data.text.substring(0, 20000);
    } catch (e) { return "❌ PDF 讀取失敗"; }
}

// ============================================================================
// ✍️ C. Gate 改寫 (核心功能：讀取 -> 思考 -> 撰寫)
// ============================================================================
async function processGateMessage(rawText) {
    try {
        let contentToProcess = rawText;
        let sourceUrl = ""; // 紀錄原始連結

        // 1. 網址偵測與閱讀
        const urlMatch = rawText.match(/(https?:\/\/[^\s]+)/g);
        if (urlMatch && urlMatch[0]) {
            sourceUrl = urlMatch[0];
            console.log(`[Gate] 發現網址，啟動閱讀程序...`);
            const readContent = await processUrl(sourceUrl);
            if (readContent) {
                // 如果讀取成功，將內容替換為讀到的文字，以便 AI 理解
                contentToProcess = `(來源網址: ${sourceUrl})\n\n網頁內容:\n${readContent}`;
            }
        }

        // 2. 替換 Prompt 變數並呼叫 Gemini
        const finalPrompt = GATE_PROMPT_TEMPLATE.replace('{{content}}', contentToProcess);
        const result = await model.generateContent(finalPrompt);

        // 3. 解析 JSON
        let jsonStr = result.response.text().replace(/```json|```/g, '').trim();
        const json = JSON.parse(jsonStr);
        
        // 4. 找圖
        const img = await fetchSmartImage(json.image_decision.keyword, json.image_decision.type);

        return { 
            content: json.content, 
            imageUrl: img, 
            sourceUrl: sourceUrl // 回傳原始連結給 Server 暫存
        };

    } catch (e) { 
        console.log(`[Gate Error] ${e.message}`);
        return null; // 回傳 null 讓 Server 知道失敗
    }
}

// ============================================================================
// 🚀 D. Make 發送器 (Fire and Forget)
// ============================================================================
async function dispatchToMake(payload) {
    const makeUrl = process.env.MAKE_WEBHOOK_URL;
    if (!makeUrl) {
        console.log("❌ [Make Error] 未設定 MAKE_WEBHOOK_URL");
        return;
    }

    console.log(`🚀 [Dispatch] 正在發送至 Make (${payload.type})...`);
    
    // Fire and Forget: 不使用 await 等待結果，直接發送並讓程式繼續往下跑
    axios.post(makeUrl, payload)
        .then(() => console.log(`✅ [Make Success] 資料已送達 Make`))
        .catch(err => console.log(`❌ [Make Failed] ${err.message}`));
}

// ============================================================================
// 🤖 E. 佔位函式 (暫時停用每日排程，以專注測試 Make)
// ============================================================================
// 注意：以下函式為空殼，僅為了防止 Server 報錯。
// 測試完 Make 後，若需要恢復每日財經/熱門影片功能，需將邏輯還原。

async function checkChannelLatestVideo(channelId) { return null; }
async function getMostPopularVideos(region) { return []; }
async function startDailyRoutine(keywords, cb) { console.log("排程暫停中"); }
async function fetchAllRSS(sources) { return []; }
async function getUSNews() { return []; }
async function getJPNews() { return []; }
async function getGBNews() { return []; }
async function getFRNews() { return []; }

module.exports = {
    processGateMessage, 
    processPDF, 
    processUrl, 
    dispatchToMake,
    // 以下導出是為了相容 Server 呼叫，避免報錯
    checkChannelLatestVideo, getMostPopularVideos, startDailyRoutine, 
    fetchAllRSS, getUSNews, getJPNews, getGBNews, getFRNews
};