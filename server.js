// ============================================================================
// === Big 3: Gate-Room (社群發布 - 智能進度回報版) ===
// ============================================================================
bot.on('channel_post', async (msg) => {
    // 1. 檢查是否為目標頻道
    if (process.env.GATE_CHANNEL_ID && String(msg.chat.id) !== String(process.env.GATE_CHANNEL_ID)) return;
    
    const rawText = msg.text || msg.caption;
    if (!rawText) return;

    // 2. [UX] 立即回傳「處理中」訊息 (避免使用者以為當機)
    // 這樣做可以讓使用者知道 Bot 活著，且爭取 AI 思考的 15-20 秒時間
    const sentMsg = await bot.sendMessage(msg.chat.id, "🔍 正在讀取並分析內容，請稍候...");

    // 3. 呼叫 Service 處理 (讀取 + AI 改寫)
    const draft = await services.processGateMessage(rawText);

    if (draft) {
        // 4. 準備最終內容
        let content = draft.content;
        
        // 如果有圖，將圖片網址附在最後，並加上 Image Source 標記讓 Make 抓取
        if (draft.imageUrl) content += `\n\n🖼️ IMAGE_SRC: ${draft.imageUrl}`;
        // 重要：附上原始來源連結，讓 Make 路徑 C (資料庫) 可以使用
        if (draft.sourceUrl) content += `\n🔗 SOURCE_URL: ${draft.sourceUrl}`;

        // 5. [UX] 編輯原本那則「處理中」的訊息，變成最終結果 + 按鈕
        await bot.editMessageText(content, {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id, // 編輯剛剛那則訊息
            disable_web_page_preview: false, // 讓 Telegram 顯示連結預覽圖
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🏀 體育版', callback_data: 'post_sports' }, 
                        { text: '💰 財經版', callback_data: 'post_finance' } // 這是你目前測試通的那條路
                    ],
                    [{ text: '💾 存入庫存', callback_data: 'save_vault' }]
                ]
            }
        });
    } else {
        // 失敗時也要編輯訊息告知
        await bot.editMessageText("⚠️ 處理失敗，無法讀取網頁或 AI 發生錯誤。", {
            chat_id: msg.chat.id,
            message_id: sentMsg.message_id
        });
    }
});

// 處理按鈕點擊 (觸發 Make)
bot.on('callback_query', async (q) => {
    // 1. 快速回應 Telegram (停止轉圈圈)
    await bot.answerCallbackQuery(q.id, { text: '🚀 發射!' });

    // 2. 解析訊息內容
    let content = q.message.text;
    let imageUrl = '';
    let sourceUrl = '';

    // 從文字中提煉出圖片與來源 (透過 Regex)
    const imgMatch = content.match(/🖼️ IMAGE_SRC: (.*)/);
    if (imgMatch) { 
        imageUrl = imgMatch[1]; 
        content = content.replace(imgMatch[0], '').trim(); // 清理掉標記
    }

    const srcMatch = content.match(/🔗 SOURCE_URL: (.*)/);
    if (srcMatch) {
        sourceUrl = srcMatch[1];
        content = content.replace(srcMatch[0], '').trim(); // 清理掉標記
    }

    // 3. 打包資料給 Make
    const payload = {
        type: q.data,          // post_finance, post_sports, save_vault
        content: content,      // 乾淨的貼文內容
        imageUrl: imageUrl,    // 圖片連結
        sourceUrl: sourceUrl,  // 原始新聞連結
        timestamp: new Date().toISOString()
    };

    // 4. 發射 (Fire and Forget)
    services.dispatchToMake(payload);

    // 5. 更新按鈕狀態 (顯示已發射)
    await bot.editMessageText(`${content}\n\n✅ [已發送到 ${q.data}]`, { 
        chat_id: q.message.chat.id, 
        message_id: q.message.message_id, 
        reply_markup: { inline_keyboard: [] } // 移除按鈕避免重複按
    });
});