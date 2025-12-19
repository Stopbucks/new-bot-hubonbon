// 引入核心工具
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// 設定變數
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ★★★ 最終修正：改回從 Render 保險箱讀取 (安全模式) ★★★
// (請確認 Render 網頁上的 Environment Variables 已經是那把新鑰匙喔！)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// 標記版本為 121905 (Final)
app.get('/', (req, res) => res.send('機器人運作中 (Ver 121905 - Final Stable)'));

// 機器人邏輯
bot.on('text', async (ctx) => {
    console.log(`[121905] 收到訊息: ${ctx.message.text}`);
    await ctx.sendChatAction('typing');

    try {
        // 維持這個正確的模型名稱
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        
        const result = await model.generateContent(ctx.message.text);
        const response = await result.response;
        const text = response.text();
        
        await ctx.reply(text);
        console.log('[121905] 回復成功！');
    } catch (error) {
        console.error('[121905] 發生錯誤:', error);
        await ctx.reply(`抱歉，機器人休息中 (Ver 121905)。錯誤訊息：${error.message}`);
    }
});

// 啟動伺服器
app.listen(PORT, () => console.log(`Server running on port ${PORT} (Ver 121905)`));

// 啟動機器人
bot.launch().then(() => console.log('Telegram Bot 已重啟成功 (Ver 121905)！'));

// 優雅關閉
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));