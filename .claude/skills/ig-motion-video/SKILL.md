---
name: ig-motion-video
description: Make a 9:16 IG Reels motion-graphics video in this repo (finance / insurance education for @timzz1208). Use when asked to make, continue, revise, or re-render an animation or short video from a script, storyboard, or handoff doc. Covers the time-function canvas engine, keyframe-first workflow, Playwright → ffmpeg render, fonts, IG safe zones, file size, and content red lines.
---

# IG 直式動畫製作

前幾支（`family-flow/`、`money-swap/`）的做法整理成固定流程。細節與踩過的坑在 `docs/motion-notes.md`，開工前先讀第三～五節。

## 1. 先定規格（從腳本或交接包抓）

- 主題一句話、長度、幀率（教育片 30fps 就夠）、1080×1920
- 每一幕：時間 | 畫面發生什麼 | 畫面字卡 | 轉場
- 視覺：底色、主色、強調色、字體。交接包有指定就照做；沒有就自己定，但避開深藍＋發光
- 一個貫穿全片的視覺母題（例如「從終點往回畫的路線」），讓每一幕不是各自為政
- 聲音：沒說要就不做，保留音軌給使用者

## 2. 檔案結構（一個題目一個資料夾）

| 檔案 | 用途 |
|---|---|
| `video.html` | 動畫本體。`window.renderAt(t)` 畫第 t 秒，`window.DURATION` 總長；瀏覽器開啟可播放、拖曳 |
| `render.js` | Playwright 逐格截圖 → ffmpeg；`--frames 1,5.5` 只輸出定格；`--clean` 輸出無字版 |
| `README.md` | 分鏡表、時間軸、怎麼重新輸出、公開前注意事項 |

畫面必須是**時間的純函數**：不留累積狀態、不用 `Math.random()`（用固定種子），同一秒永遠同一格。

## 3. 工作順序

1. 寫分鏡與版面座標（安全區：上下各 250px、左右各 86px；右下角是 Reels 按鈕）
2. 每一幕輸出 1 張關鍵定格 → 自己看過一輪、修掉擠壓與重疊
3. 輸出完整預覽（低位元率即可）→ 交給使用者用導演指令修改
4. 正式輸出

使用者不在線時，可以把 2～3 一次做完，但要標明是「預覽」，不是最終版。

## 4. 文字與字型

- 字卡全部由程式畫，不交給生圖模型
- 中文字型要本地注入（Google Fonts 的 TTF 下載到 `/tmp/fonts`，用 `FONT_*` 環境變數傳給 `render.js`），否則會退回系統字體
- 數字用 Roboto 500／700，中文用 Noto Sans TC；字型堆疊寫 `"Roboto","Noto Sans TC"` 讓兩者自動分工
- 所有字經過同一個 `T()`，才做得出 `?clean=1` 無字版
- 靜音也要看得懂：畫面字卡要能獨立說完故事

## 5. 輸出

```bash
FONT_DIR=/tmp/fonts node render.js --frames 0,10,20          # 定格
FONT_DIR=/tmp/fonts node render.js --vbitrate 4M             # 完整影片
FONT_DIR=/tmp/fonts node render.js --clean --vbitrate 4M     # 無字版
```

- 用固定位元率（4–7 Mbps），傳給使用者的檔案上限 30MB
- 有逐格顆粒會讓檔案暴增；紙紋用靜態圖樣，跟著鏡頭移動即可

## 6. 內容紅線（財務／保險）

- 數字一律標示「示意」，不寫保證、翻倍、穩賺、財富自由
- 不放商品名、保費、報酬率、個案建議；外部統計沒有來源就不加
- 片尾放 `@timzz1208` 與「一般資訊整理，不構成投資、保險或個人化財務建議」
- 公開前走公司審核流程
