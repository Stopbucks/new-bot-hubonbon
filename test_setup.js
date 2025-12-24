/**
 * 🧪 API 連線測試腳本
 * 用途：確認 .env 設定正確，且所有 API 都能正常回傳數據
 * 執行指令：node test_setup.js
 */
const { searchYouTube, searchGoogle, generateAnalysis } = require('./services_Backup_big15');

async function testRun() {
    console.log('=== 🚀 開始測試 Big 1.5 流程 ===');

    // 1. 設定測試關鍵字
    const keyword = '大谷翔平'; 

    // 2. 測試 YouTube
    const ytResult = await searchYouTube(keyword);
    if (!ytResult) {
        console.log('❌ YouTube 測試失敗');
        return;
    }
    console.log(`✅ YouTube 成功抓到: ${ytResult.title}`);

    // 3. 測試 Google Search (拿影片標題去搜)
    const googleResult = await searchGoogle(ytResult.title);
    console.log(`✅ Google 成功抓到 ${googleResult.length} 筆新聞`);
    if(googleResult.length > 0) {
        console.log(`   第一筆: ${googleResult[0].title}`);
    }

    // 4. 測試 Gemini 分析
    const finalReport = await generateAnalysis(ytResult, googleResult);
    console.log('\n=== 🤖 Gemini 分析結果 ===\n');
    console.log(finalReport);
    console.log('\n=== ✅ 測試結束 ===');
}

testRun();