// 引入核心工具
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// 設定變數
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ★★★ 暴力測試區：直接把鑰匙寫死在程式碼裡 ★★★
// (請注意：這只是為了測試，確認鑰匙本身沒問題。測試完後我們會改回來)
const genAI = new GoogleGenerativeAI("AIzaSyA7GE6ez07HoEKKzJ6fava1v8piekzlh50");

const app = express();
const PORT = process.env.PORT || 3000;

// 標記版本為 121903 (Hardcode Test)
app.get('/', (req, res) => res.send('機器人運作中 (Ver 121903 - Hardcode Test)'));

// 機器人邏輯
bot.on('text', async (ctx) => {
    console.log(`[121903] 收到訊息: ${ctx.message.text}`);
    await ctx.sendChatAction('typing');

    try {
        // 使用標準版 gemini-pro
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const result = await model.generateContent(ctx.message.text);
        const response = await result.response;
        const text = response.text();
        
        await ctx.reply(text);
        console.log('[121903] 回復成功！');
    } catch (error) {
        console.error('[121903] 發生錯誤:', error);
        await ctx.reply(`抱歉，發生錯誤 (Ver 121903)。錯誤訊息：${error.message}`);
    }
});

// 啟動伺服器
app.listen(PORT, () => console.log(`Server running on port ${PORT} (Ver 121903)`));

// 啟動機器人
bot.launch().then(() => console.log('Telegram Bot 已重啟成功 (Ver 121903)！'));

// 優雅關閉
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));