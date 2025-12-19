// 引入核心工具
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// 設定變數
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);

// ★★★ 步驟一：保持暴力測試狀態 (確認 Key 沒問題) ★★★
// 繼續使用你提供的這把測試鑰匙
const genAI = new GoogleGenerativeAI("AIzaSyA7GE6ez07HoEKKzJ6fava1v8piekzlh50");

const app = express();
const PORT = process.env.PORT || 3000;

// 標記版本為 121904 (Model Name Fix)
app.get('/', (req, res) => res.send('機器人運作中 (Ver 121904 - Model Fixed)'));

// 機器人邏輯
bot.on('text', async (ctx) => {
    console.log(`[121904] 收到訊息: ${ctx.message.text}`);
    await ctx.sendChatAction('typing');

    try {
        // ★★★ 步驟二：修正模型名稱 ★★★
        // 根據截圖，你的新帳號指定要用這個預覽版模型
        const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
        
        const result = await model.generateContent(ctx.message.text);
        const response = await result.response;
        const text = response.text();
        
        await ctx.reply(text);
        console.log('[121904] 回復成功！');
    } catch (error) {
        console.error('[121904] 發生錯誤:', error);
        await ctx.reply(`抱歉，發生錯誤 (Ver 121904)。錯誤訊息：${error.message}`);
    }
});

// 啟動伺服器
app.listen(PORT, () => console.log(`Server running on port ${PORT} (Ver 121904)`));

// 啟動機器人
bot.launch().then(() => console.log('Telegram Bot 已重啟成功 (Ver 121904)！'));

// 優雅關閉
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));