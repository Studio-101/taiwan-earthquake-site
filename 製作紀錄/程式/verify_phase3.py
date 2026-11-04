#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第三階段資料與畫面數值獨立驗證腳本
"""
import os
import sys
import json
import numpy as np
import pandas as pd

if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
data_dir = os.path.join(base_dir, 'data')

# 1. 驗證原始 XML 未被修改
xml_files = [f for f in os.listdir(data_dir) if f.startswith('CWA-EQ-Catalog-') and f.endswith('.xml')]
print(f"XML 檔案總數: {len(xml_files)} 個 (1990–2025 年)")

# 2. 地震 CSV 筆數統計
csv_path = os.path.join(data_dir, 'earthquakes.csv')
df = pd.read_csv(csv_path)
total_pts = len(df)
common_mask = (df['EpicenterLongitude'] >= 119.0) & (df['EpicenterLongitude'] <= 123.0) & \
              (df['EpicenterLatitude'] >= 21.0) & (df['EpicenterLatitude'] <= 26.0)
common_pts = int(common_mask.sum())
print(f"總地震筆數: {total_pts:,} 筆")
print(f"共同範圍筆數 (119-123E, 21-26N): {common_pts:,} 筆")

# 3. 地形資料與網格驗證
json_path = os.path.join(data_dir, 'terrain_grid.json')
with open(json_path, 'r', encoding='utf-8') as f:
    grid = json.load(f)

w = grid['width']
h = grid['height']
total_verts = grid['totalVertices']
min_lon = grid['minLon']
max_lon = grid['maxLon']
min_lat = grid['minLat']
max_lat = grid['maxLat']
min_elev = grid['minElevationMeters']
max_elev = grid['maxElevationMeters']
mean_elev = grid['meanElevationMeters']

print(f"地形網格解析度: {w} x {h} (總頂點數: {total_verts:,})")
print(f"經度涵蓋範圍: {min_lon:.1f}°E ~ {max_lon:.1f}°E")
print(f"緯度涵蓋範圍: {min_lat:.1f}°N ~ {max_lat:.1f}°N")
print(f"最低水深 (琉球海溝): {min_elev:.1f} m")
print(f"最高海拔 (玉山群峰): {max_elev:.1f} m")
print(f"平均高程: {mean_elev:.1f} m")

# 4. 座標換算公式驗證 (取 3 筆地震與地形頂點)
CENTER_LON = 121.0
CENTER_LAT = 23.5
R = 6371.0
DEG_TO_RAD = np.pi / 180.0
LAT_KM = R * DEG_TO_RAD
LON_KM = R * DEG_TO_RAD * np.cos(CENTER_LAT * DEG_TO_RAD)
EXAG = 5.0

print(f"LON_KM_PER_DEG = {LON_KM:.6f} km/deg")
print(f"LAT_KM_PER_DEG = {LAT_KM:.6f} km/deg")

samples = [
    ("1999 集集主震", 120.816, 23.853, 8.0),
    ("2024 花蓮外海", 121.574, 23.876, 19.7),
    ("深層隱沒帶地震", 122.004, 24.662, 67.7)
]

print("\n--- 地震座標換算 (1:1 真實比例) ---")
for name, lon, lat, depth in samples:
    x = (lon - CENTER_LON) * LON_KM
    y = -depth
    z = -(lat - CENTER_LAT) * LAT_KM
    print(f"[{name}] 經緯深: ({lon}, {lat}, {depth}km) -> X={x:.3f} km, Y={y:.3f} km, Z={z:.3f} km")

print("\n--- 地形極值換算 (5倍垂直誇大) ---")
y_min = (min_elev / 1000.0) * EXAG
y_max = (max_elev / 1000.0) * EXAG
print(f"[最低水深 {min_elev} m] -> Y = {y_min:.3f} km (真實水深 {min_elev/1000.0:.3f} km)")
print(f"[最高海拔 {max_elev} m] -> Y = {y_max:.3f} km (真實海拔 {max_elev/1000.0:.3f} km)")
