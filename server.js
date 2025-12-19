// 引入核心工具
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// 設定變數 (確保 Render 的環境變數已經換成新鑰匙了喔！)
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

// 防止休眠的網站入口
// ★ 修改點：加上 1219 標記，打開瀏覽器看到這行字，就知道更新成功了
app.get('/', (req, res) => res.send('機器人運作中 (Ver 1219 更新版)'));

// 機器人邏輯
bot.on('text', async (ctx) => {
    console.log(`[1219] 收到訊息: ${ctx.message.text}`); // Log 也加上標記
    await ctx.sendChatAction('typing');

    try {
        // 使用最通用的模型名稱
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const result = await model.generateContent(ctx.message.text);
        const response = await result.response;
        const text = response.text();
        
        await ctx.reply(text);
        console.log('[1219] 回復成功！');
    } catch (error) {
        console.error('[1219] 發生錯誤:', error);
        await ctx.reply('抱歉，目前連線有點問題，請稍後再試。');
    }
});

// 啟動伺服器
app.listen(PORT, () => console.log(`Server running on port ${PORT} (Ver 1219)`));

// 啟動機器人
bot.launch().then(() => console.log('Telegram Bot 已重啟成功 (Ver 1219)！'));

// 優雅關閉
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));