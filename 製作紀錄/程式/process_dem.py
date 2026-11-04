#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台灣地形與海底水深網格處理腳本 (Phase 3)
=====================================
執行方式：
    python scripts/process_dem.py

說明：
    讀取 data/taiwan_dem.tiff (ETOPO 2022 / GEBCO 15 弧秒 GeoTIFF)，
    將高解析度網格 (960x1200) 降採樣轉換為適合 WebGL 即時渲染的 3D 地形資料：
    輸出至 data/terrain_grid.json。
    包含：網格解析度、經緯度邊界、極值統計、以及扁平化高程陣列 (公尺)。
"""

import os
import sys
import json
import numpy as np
from PIL import Image

# 確保輸出編碼為 UTF-8
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
INPUT_TIFF = os.path.join(DATA_DIR, 'taiwan_dem.tiff')
OUTPUT_JSON = os.path.join(DATA_DIR, 'terrain_grid.json')

def main():
    if not os.path.exists(INPUT_TIFF):
        print(f"錯誤：找不到輸入檔案 {INPUT_TIFF}")
        sys.exit(1)

    print(f"正在讀取地形檔案: {INPUT_TIFF}...")
    with Image.open(INPUT_TIFF) as img:
        orig_w, orig_h = img.size
        arr = np.array(img).astype(np.float32)

    print(f"原始尺寸: {orig_w} x {orig_h} 像素")
    print(f"原始高程極值: 最低水深 {arr.min():.1f} m, 最高海拔 {arr.max():.1f} m")

    # 採用 step = 4 降採樣：960x1200 -> 240x300
    # 在 1920x1080 螢幕上既能呈現精緻起伏，又能維持 WebGL 60 FPS 順暢度
    step = 4
    sub = arr[::step, ::step]
    grid_h, grid_w = sub.shape

    min_elev = float(np.min(sub))
    max_elev = float(np.max(sub))
    mean_elev = float(np.mean(sub))

    # 扁平化並保留一位小數以節省傳輸大小
    flat_elevations = np.round(sub.flatten(), 1).tolist()

    metadata = {
        "width": grid_w,
        "height": grid_h,
        "minLon": 119.0,
        "maxLon": 123.0,
        "minLat": 21.0,
        "maxLat": 26.0,
        "minElevationMeters": round(min_elev, 1),
        "maxElevationMeters": round(max_elev, 1),
        "meanElevationMeters": round(mean_elev, 1),
        "totalVertices": len(flat_elevations),
        "source": "NOAA ETOPO 2022 / GEBCO (15 arc-second)",
        "license": "Public Domain",
        "elevations": flat_elevations
    }

    print(f"輸出目標網格: {grid_w} x {grid_h} ({len(flat_elevations):,} 個頂點)")
    print(f"降採樣高程極值: 最低 {min_elev:.1f} m, 最高 {max_elev:.1f} m")

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False)

    file_size_kb = os.path.getsize(OUTPUT_JSON) / 1024
    print(f"處理完成！產出檔案: {OUTPUT_JSON} (大小: {file_size_kb:.1f} KB)")

if __name__ == '__main__':
    main()
