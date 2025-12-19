// 引入我們需要的工具
require('dotenv').config(); // 這行指令會自動去讀取你的 .env 保險箱
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// --- 這裡就是「去保險箱拿鑰匙」的動作 ---
// 注意看，我們這裡沒有寫死密碼，而是用 process.env
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const app = express();

// 設定 Render 需要的網站入口 (為了防休眠)
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.send('我是機器人，我還醒著！(Web Service is running)');
});

// --- 機器人的大腦邏輯開始 ---

// 1. 當有人輸入 "/start" 時的歡迎詞
bot.start((ctx) => {
    ctx.reply('嗨！我是你的 AI 小幫手。請直接傳送文字給我，我會幫你用 Gemini 回覆喔！');
});

// 2. 當機器人收到「任何文字訊息」時
bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text; // 客人說的話
    console.log(`收到訊息: ${userMessage}`); // 在黑視窗印出來給你看

    // 告訴客人「我在想...」，顯示輸入中狀態
    await ctx.sendChatAction('typing');

    try {
        // 呼叫 Gemini 大腦
        // 修改重點：加上 -001 版本號，這是目前最穩定的 Flash 版本
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-001"});
        
        const result = await model.generateContent(userMessage);
        const response = await result.response;
        const text = response.text();

        // 把 AI 的回覆傳回給客人
        await ctx.reply(text);
        console.log('已回覆客人');

    } catch (error) {
        console.error('發生錯誤:', error);
        ctx.reply('抱歉，我現在腦袋有點打結，請稍後再試。');
    }
});

// --- 啟動區 ---

// 啟動網站伺服器 (給 Render 看的)
app.listen(PORT, () => {
    console.log(`網站伺服器已啟動，正在監聽 Port: ${PORT}`);
});

// 啟動機器人 (開始接客)
bot.launch().then(() => {
    console.log('機器人已成功登入 Telegram！開始服務...');
}).catch((err) => {
    console.error('機器人啟動失敗:', err);
});

// 優雅關機設定 (避免當機卡死)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));