# 第一階段：資料轉換

目標：把 36 個年份的 XML 合併成一個乾淨的 `data/earthquakes.csv`，並證明轉換沒有遺漏或出錯。這個階段不做任何畫面。

## 要做的事

1. 先讀 `docs/data-notes.md`。
2. 在 `scripts/` 寫一個轉換腳本（Python 或 Node.js 皆可，寫在檔案開頭說明怎麼執行）：
   - 讀取 `data/CWA-EQ-Catalog-1990.xml` 到 `data/CWA-EQ-Catalog-2025.xml`
   - 每筆地震輸出一列，欄位名稱保留原文：`OriginTime`、`EpicenterLongitude`、`EpicenterLatitude`、`FocalDepth`、`LocalMagnitude`、`Quality`、`ReviewStatus`
   - 另外加兩欄：`Year`（來源檔案的年份）、`InFileRegion`（是否在該檔標示的範圍內，true／false）
   - 數值去除前後空白；不篩選、不刪除任何一筆
   - 輸出到 `data/earthquakes.csv`，UTF-8 編碼
3. 執行腳本，並讓腳本本身印出以下統計（不要用手算或從文件抄）：
   - 每個檔案：實際筆數、`RecordNumber`、兩者是否相等、該檔標示的 Region
   - 合併後總筆數
   - 經度、緯度、深度、規模的最小值與最大值
   - 超出該檔 Region 的筆數（每年與合計）
   - 缺值或無法解析的筆數
   - 每年 Quality 為 A、B、C、D 的筆數
   - 全部資料中規模最大的 5 筆（原始數值）
4. 用 `verify-data` 技能產生驗證報告。

## 完成後

停下來，把腳本印出的統計和驗證報告給我看，等我確認後才進行第二階段。
