#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
驗證第四階段（互動篩選與白話說明卡片）資料計算與邏輯正確性
依據 .agents/skills/verify-data/SKILL.md 規範產出報告數據
"""

import csv
import json
from pathlib import Path

DATA_CSV = Path(__file__).resolve().parent.parent / "data" / "earthquakes.csv"

def verify_phase4():
    print("=== 開始第四階段資料與篩選驗證 ===")
    
    total_records = 0
    common_bounds = {
        'min_lon': 119.0, 'max_lon': 123.0,
        'min_lat': 21.0,  'max_lat': 26.0
    }
    
    # 統計指標
    common_count = 0
    year_cumulative_counts = {}
    mag_counts = {3.0: 0, 4.0: 0, 5.0: 0, 6.0: 0}
    mag_common_counts = {3.0: 0, 4.0: 0, 5.0: 0, 6.0: 0}
    quality_counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'Other': 0}
    quality_common_counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'Other': 0}
    
    # 特殊事件檢驗 (例如 1999 集集大地震)
    jiji_records = []
    
    with open(DATA_CSV, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_records += 1
            year = int(row['Year'])
            lon = float(row['EpicenterLongitude'])
            lat = float(row['EpicenterLatitude'])
            depth = float(row['FocalDepth'])
            mag = float(row['LocalMagnitude'])
            quality = row['Quality'].strip()
            
            in_common = (
                common_bounds['min_lon'] <= lon <= common_bounds['max_lon'] and
                common_bounds['min_lat'] <= lat <= common_bounds['max_lat']
            )
            
            if in_common:
                common_count += 1
            
            # 年份累積 (共同範圍內)
            for y in range(1990, 2026):
                if year <= y:
                    year_cumulative_counts[y] = year_cumulative_counts.get(y, 0) + (1 if in_common else 0)
            
            # 規模統計 (全部與共同範圍)
            for m in [3.0, 4.0, 5.0, 6.0]:
                if mag >= m:
                    mag_counts[m] += 1
                    if in_common:
                        mag_common_counts[m] += 1
            
            # Quality 統計
            if quality in quality_counts:
                quality_counts[quality] += 1
                if in_common:
                    quality_common_counts[quality] += 1
            else:
                quality_counts['Other'] += 1
                if in_common:
                    quality_common_counts['Other'] += 1
            
            # 檢驗 1999 最大地震 (集集地震)
            if year == 1999 and mag >= 7.0:
                jiji_records.append(row)
                
    print(f"1. 總筆數: {total_records} (預期 73,729)")
    print(f"2. 共同範圍筆數 (預設顯示): {common_count}")
    print("\n3. 共同範圍下各規模階層累積筆數:")
    for m in [3.0, 4.0, 5.0, 6.0]:
        print(f"   - 規模 >= {m}: {mag_common_counts[m]} 筆 (全範圍: {mag_counts[m]} 筆)")
        
    print("\n4. 共同範圍下各 Quality 等級筆數:")
    for q in ['A', 'B', 'C', 'D']:
        print(f"   - 等級 {q}: {quality_common_counts[q]} 筆 (全範圍: {quality_counts[q]} 筆)")
        
    print("\n5. 年份逐年累積筆數關鍵節點 (共同範圍):")
    for y in [1990, 1995, 1999, 2000, 2010, 2020, 2024, 2025]:
        print(f"   - 1990 至 {y} 年累積: {year_cumulative_counts[y]} 筆")
        
    print("\n6. 檢驗 1999 年最大地震紀錄 (集集地震 1999-09-21):")
    for r in jiji_records:
        print(f"   - 時間: {r['OriginTime']}, 經度: {r['EpicenterLongitude']}, 緯度: {r['EpicenterLatitude']}, 深度: {r['FocalDepth']} km, 規模: {r['LocalMagnitude']}, Quality: {r['Quality']}")

    return {
        'total': total_records,
        'common': common_count,
        'mag_common': mag_common_counts,
        'quality_common': quality_common_counts,
        'year_cumulative': year_cumulative_counts,
        'jiji': jiji_records
    }

if __name__ == '__main__':
    verify_phase4()
