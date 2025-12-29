/**
 * ==============================================================================
 * 🛠️ Info Commander Server (Commander Mode - Final)
 * ==============================================================================
 * [Feature]: 
 * 1. Room Detection: Bridge (Summary) vs Gate (Social Post)
 * 2. Magic Button: Send to Make (Matched with Make Filter: type="post_finance")
 * 3. Service Integration: Uses services.js for heavy lifting
 * ==============================================================================
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const services = require('./services'); // 引入你的 services.js

// --- 環境變數 ---
const token = process.env.TELEGRAM_TOKEN;
const port = process.env.PORT || 10000;

// 建議在 .env 設定這兩個 ID，若無則預設為空 (會變成全功能模式)
const BRIDGE_CHAT_ID = process.env.BRIDGE_CHAT_ID || ''; 
const GATE_CHAT_ID = process.env.GATE_CHAT_ID || '';

if (!token) {
    console.error("❌ 錯誤：未設定 TELEGRAM_TOKEN");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const app = express();

console.log("🚀 Server Started: Commander Mode Online");

// ============================================================================
// 🎛️ 互動按鈕定義 (Gate Room 專用)
// ============================================================================
// 這裡的 callback_data 必須嚴格對應你在 Make 設定的 Filter 值！
const GATE_KEYBOARD = {
    reply_markup: {
        inline_keyboard: [
            [
                // 對應 Make Filter: type = post_finance
                { text: "💰 發射：財經粉專", callback_data: "post_finance" },
                // 對應 Make Filter: type = post_sports
                { text: "⚾ 發射：體育粉專", callback_data: "post_sports" }
            ],
            [
                // 這可以設定另外一條路，或者共用
                { text: "💾 純存檔 (Database)", callback_data: "save_db" }
            ]
        ]
    }
};

// ============================================================================
// 👂 監聽按鈕點擊事件 (The Trigger)
// ============================================================================
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const action = callbackQuery.data; // 這裡會收到 'post_finance' 等
    const chatId = msg.chat.id;

    // 1. UI 回饋 (消除漏斗圖示)
    bot.answerCallbackQuery(callbackQuery.id, { text: '🚀 發射指令確認！' });

    // 2. 抓取內容
    const contentToSend = msg.text;
    
    // 3. 準備 Payload (完全對齊 Make 格式)
    // 這裡我們把 action (例如 post_finance) 直接塞給 type
    // 這樣你的 Make Filter (Bundle 1: type = post_finance) 就會通過！
    const payload = {
        type: action, 
        content: contentToSend,
        source: 'telegram_button',
        timestamp: new Date().toISOString()
    };

    try {
        // 4. 呼叫 Service 發射
        await services.dispatchToMake(payload);

        // 5. 修改原本的訊息，標記為「已發送」
        // 加上 ✅ 讓你知道這則已經處理過了
        await bot.editMessageText(`${contentToSend}\n\n✅ [${action}] 已發射成功！`, {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: 'Markdown' 
        });

    } catch (error) {
        console.error("發送失敗:", error);
        bot.sendMessage(chatId, `❌ 發送失敗: ${error.message}`);
    }
});

// ============================================================================
// 📨 訊息處理主邏輯 (Room Router)
// ============================================================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text;
    
    if (msg.from.is_bot) return; // 忽略機器人自己

    // --- 判斷目前在哪個房間 ---
    const isGateRoom = (chatId === GATE_CHAT_ID);
    const isBridgeRoom = (chatId === BRIDGE_CHAT_ID);
    // 如果沒有設定 ID，預設哪裡都通用 (方便測試)
    const isUniversalMode = (!GATE_CHAT_ID && !BRIDGE_CHAT_ID);

    try {
        // 1. 網址偵測邏輯 (Regex 掃描)
        const urlMatch = text ? text.match(/(https?:\/\/[^\s]+)/g) : null;

        // ==================================================
        // 🚪 Gate Room 邏輯 (產出 + 按鈕)
        // ==================================================
        if (isGateRoom || isUniversalMode) {
            
            if (urlMatch || msg.document) {
                bot.sendChatAction(chatId, 'typing');
                
                let result = null;
                if (urlMatch) {
                     bot.sendMessage(chatId, "🌐 Gate 啟動：正在轉化為社群貼文...");
                     // 呼叫 Service 裡的 Gate 處理函數 (讀取 -> 思考 -> 撰寫)
                     result = await services.processGateMessage(text);
                }
                // (未來如果要加 PDF 處理，可以寫在這裡呼叫 services.processPDF)

                if (result && result.content) {
                    // ✅ 關鍵：發送內容並附帶「GATE_KEYBOARD」
                    await bot.sendMessage(chatId, result.content, GATE_KEYBOARD);
                } 
                return; // Gate 處理完就結束
            }
        }

        // ==================================================
        // 🌉 Bridge Room 邏輯 (詳細摘要，無按鈕)
        // ==================================================
        if (isBridgeRoom) {
             // 這裡可以放原本的邏輯，或者先留空，等你需要區分時再擴充
             // 目前如果沒有網址，可能就不動作
        }

    } catch (error) {
        console.error("Error:", error);
        bot.sendMessage(chatId, `⚠️ 處理發生錯誤: ${error.message}`);
    }
});

// --- RSS 測試窗口 ---
app.get('/rss-test', async (req, res) => {
    // 這裡我們簡單回傳，因為主要的 RSS 邏輯在 GitHub Actions + curl 觸發的 services
    res.send("RSS Test Endpoint is Active.");
});

app.get('/', (req, res) => { res.send('Info Commander (Commander Mode) is Running'); });
app.listen(port, () => { console.log(`Server running on port ${port}`); });