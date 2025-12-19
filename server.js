// 引入核心工具
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// 設定變數
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

// 防止休眠的網站入口
// ★ 修改點：加上 121902 標記，確認是今日第 2 版
app.get('/', (req, res) => res.send('機器人運作中 (Ver 121902)'));

// 機器人邏輯
bot.on('text', async (ctx) => {
    console.log(`[121902] 收到訊息: ${ctx.message.text}`); // Log 加上版本號
    await ctx.sendChatAction('typing');

    try {
        // ★ 關鍵設定：使用最穩定的 gemini-pro，避免新模型找不到的問題
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const result = await model.generateContent(ctx.message.text);
        const response = await result.response;
        const text = response.text();
        
        await ctx.reply(text);
        console.log('[121902] 回復成功！');
    } catch (error) {
        console.error('[121902] 發生錯誤:', error);
        await ctx.reply(`抱歉，發生錯誤 (Ver 121902)。錯誤訊息：${error.message}`);
    }
});

// 啟動伺服器
app.listen(PORT, () => console.log(`Server running on port ${PORT} (Ver 121902)`));

// 啟動機器人
bot.launch().then(() => console.log('Telegram Bot 已重啟成功 (Ver 121902)！'));

// 優雅關閉
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));