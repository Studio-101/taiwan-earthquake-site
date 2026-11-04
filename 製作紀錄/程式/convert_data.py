#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台灣地震目錄資料轉換腳本 (1990–2025)
=====================================
執行方式：
    python scripts/convert_data.py

說明：
    讀取 data/CWA-EQ-Catalog-1990.xml 至 data/CWA-EQ-Catalog-2025.xml，
    將 36 個年份的地震目錄整合為單一 CSV 檔：data/earthquakes.csv。
    不篩選、不補齊、不刪除任何原始資料，並輸出統計數據與檢驗指標。
"""

import os
import sys
import csv
import xml.etree.ElementTree as ET

# 確保輸出編碼為 UTF-8
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# 命名空間定義
XML_NS = {'cwa': 'urn:cwa:gov:tw:cwacommon:0.1'}

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
OUTPUT_CSV = os.path.join(DATA_DIR, 'earthquakes.csv')

def parse_range_str(range_str):
    """
    解析 '118.000-124.000' 格式的字串為 (min_val, max_val)。
    以 '-' 分割兩側數值。
    """
    parts = range_str.strip().split('-')
    if len(parts) == 2:
        return float(parts[0].strip()), float(parts[1].strip())
    raise ValueError(f"無法解析範圍字串: {range_str}")

def main():
    years = list(range(1990, 2026))
    
    total_records = 0
    all_rows = []
    
    # 統計用變數
    file_stats = []
    yearly_out_of_region = {}
    yearly_quality_counts = {}
    missing_or_unparseable_count = 0
    
    min_lon = float('inf')
    max_lon = float('-inf')
    min_lat = float('inf')
    max_lat = float('-inf')
    min_depth = float('inf')
    max_depth = float('-inf')
    min_mag = float('inf')
    max_mag = float('-inf')
    
    print("=" * 70)
    print("開始執行地震資料轉換 (1990–2025)...")
    print("=" * 70)

    for year in years:
        xml_filename = f"CWA-EQ-Catalog-{year}.xml"
        xml_path = os.path.join(DATA_DIR, xml_filename)
        
        if not os.path.exists(xml_path):
            print(f"[錯誤] 找不到檔案: {xml_path}", file=sys.stderr)
            sys.exit(1)
            
        tree = ET.parse(xml_path)
        root = tree.getroot()
        
        # 取得 CatalogInfo
        catalog_info = root.find('.//cwa:CatalogInfo', XML_NS)
        if catalog_info is None:
            print(f"[錯誤] {xml_filename} 找不到 CatalogInfo 節點", file=sys.stderr)
            sys.exit(1)
            
        record_number_elem = catalog_info.find('cwa:RecordNumber', XML_NS)
        record_number = int(record_number_elem.text.strip()) if record_number_elem is not None else None
        
        region_elem = catalog_info.find('cwa:Region', XML_NS)
        lon_range_str = region_elem.find('cwa:LongitudeRange', XML_NS).text.strip() if region_elem is not None else ""
        lat_range_str = region_elem.find('cwa:LatitudeRange', XML_NS).text.strip() if region_elem is not None else ""
        
        reg_min_lon, reg_max_lon = parse_range_str(lon_range_str)
        reg_min_lat, reg_max_lat = parse_range_str(lat_range_str)
        
        # 讀取所有 EarthquakeInfo
        eq_elements = root.findall('.//cwa:EarthquakeInfo', XML_NS)
        actual_count = len(eq_elements)
        is_equal = (actual_count == record_number)
        
        file_stats.append({
            'year': year,
            'actual_count': actual_count,
            'record_number': record_number,
            'is_equal': is_equal,
            'lon_range': lon_range_str,
            'lat_range': lat_range_str,
            'region_desc': f"經度: {lon_range_str} / 緯度: {lat_range_str}"
        })
        
        yearly_out_of_region[year] = 0
        yearly_quality_counts[year] = {}
        
        for eq in eq_elements:
            def get_text(tag):
                elem = eq.find(f'cwa:{tag}', XML_NS)
                return elem.text.strip() if elem is not None and elem.text is not None else ""
            
            origin_time = get_text('OriginTime')
            lon_str = get_text('EpicenterLongitude')
            lat_str = get_text('EpicenterLatitude')
            depth_str = get_text('FocalDepth')
            mag_str = get_text('LocalMagnitude')
            quality = get_text('Quality')
            review_status = get_text('ReviewStatus')
            
            # 檢查是否有缺值或無法解析
            is_valid = True
            try:
                lon_val = float(lon_str)
                lat_val = float(lat_str)
                depth_val = float(depth_str)
                mag_val = float(mag_str)
            except (ValueError, TypeError):
                is_valid = False
                missing_or_unparseable_count += 1
                lon_val = lat_val = depth_val = mag_val = None

            if not origin_time or not quality or not review_status:
                # 記錄是否有任何重要欄位遺失
                is_valid = False
                
            in_file_region = False
            if lon_val is not None and lat_val is not None:
                # 判斷是否在該檔 Region 內
                in_file_region = (reg_min_lon <= lon_val <= reg_max_lon) and (reg_min_lat <= lat_val <= reg_max_lat)
                if not in_file_region:
                    yearly_out_of_region[year] += 1
                
                # 更新極值
                if lon_val < min_lon: min_lon = lon_val
                if lon_val > max_lon: max_lon = lon_val
                if lat_val < min_lat: min_lat = lat_val
                if lat_val > max_lat: max_lat = lat_val
            
            if depth_val is not None:
                if depth_val < min_depth: min_depth = depth_val
                if depth_val > max_depth: max_depth = depth_val
                
            if mag_val is not None:
                if mag_val < min_mag: min_mag = mag_val
                if mag_val > max_mag: max_mag = mag_val
                
            # Quality 統計
            yearly_quality_counts[year][quality] = yearly_quality_counts[year].get(quality, 0) + 1
            
            row = {
                'Year': str(year),
                'OriginTime': origin_time,
                'EpicenterLongitude': lon_str,
                'EpicenterLatitude': lat_str,
                'FocalDepth': depth_str,
                'LocalMagnitude': mag_str,
                'Quality': quality,
                'ReviewStatus': review_status,
                'InFileRegion': 'true' if in_file_region else 'false',
                '_mag_val': mag_val if mag_val is not None else -1.0 # 供排序最大規模用
            }
            all_rows.append(row)
            
    total_records = len(all_rows)
    
    # 寫入 CSV
    csv_headers = [
        'Year',
        'OriginTime',
        'EpicenterLongitude',
        'EpicenterLatitude',
        'FocalDepth',
        'LocalMagnitude',
        'Quality',
        'ReviewStatus',
        'InFileRegion'
    ]
    
    with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=csv_headers, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(all_rows)
        
    print(f"\n[成功] 已將 {total_records} 筆資料寫入: {OUTPUT_CSV}")
    
    # ==========================================
    # 印出各項統計 (由程式計算，非手算)
    # ==========================================
    print("\n" + "=" * 70)
    print("【1. 各檔案讀取統計與一致性核對】")
    print(f"{'年份':<6} | {'實際筆數':<8} | {'RecordNumber':<12} | {'相等?':<6} | {'檔內標示 Region':<35}")
    print("-" * 75)
    all_equal = True
    for stat in file_stats:
        eq_str = "YES" if stat['is_equal'] else "NO"
        if not stat['is_equal']:
            all_equal = False
        print(f"{stat['year']:<6} | {stat['actual_count']:<10} | {stat['record_number']:<12} | {eq_str:<6} | {stat['region_desc']}")
    print(f"\n所有 36 個檔案筆數與 RecordNumber 是否完全相等: {'是 (通過)' if all_equal else '否 (未通過)'}")

    print("\n" + "=" * 70)
    print("【2. 合併後總筆數與極值統計】")
    print(f"合併後總筆數: {total_records}")
    print(f"經度範圍 (EpicenterLongitude): {min_lon:.3f} ~ {max_lon:.3f}")
    print(f"緯度範圍 (EpicenterLatitude):  {min_lat:.3f} ~ {max_lat:.3f}")
    print(f"深度範圍 (FocalDepth):         {min_depth:.1f} ~ {max_depth:.1f} km")
    print(f"規模範圍 (LocalMagnitude):     {min_mag:.1f} ~ {max_mag:.1f}")

    print("\n" + "=" * 70)
    print("【3. 超出該檔 Region 範圍統計】")
    total_out_of_region = sum(yearly_out_of_region.values())
    print(f"{'年份':<6} | {'超出筆數':<8}")
    print("-" * 20)
    for y in years:
        print(f"{y:<6} | {yearly_out_of_region[y]:<8}")
    print(f"合計超出檔內標示 Region 筆數: {total_out_of_region}")

    print("\n" + "=" * 70)
    print("【4. 缺值或無法解析筆數】")
    print(f"缺值或無法解析筆數: {missing_or_unparseable_count}")

    print("\n" + "=" * 70)
    print("【5. 每年 Quality 等級分佈統計 (A, B, C, D 及其他)】")
    print(f"{'年份':<6} | {'A':<6} | {'B':<6} | {'C':<6} | {'D':<6} | {'其他':<6} | {'C+D 比例':<10}")
    print("-" * 55)
    for y in years:
        q_map = yearly_quality_counts[y]
        a = q_map.get('A', 0)
        b = q_map.get('B', 0)
        c = q_map.get('C', 0)
        d = q_map.get('D', 0)
        other = sum(v for k, v in q_map.items() if k not in ('A', 'B', 'C', 'D'))
        tot = sum(q_map.values())
        cd_ratio = ((c + d) / tot * 100) if tot > 0 else 0
        print(f"{y:<6} | {a:<6} | {b:<6} | {c:<6} | {d:<6} | {other:<6} | {cd_ratio:5.1f}%")

    print("\n" + "=" * 70)
    print("【6. 全部資料中規模最大的 5 筆地震 (原始數值)】")
    # 依規模降冪排序
    sorted_rows = sorted(all_rows, key=lambda r: r['_mag_val'], reverse=True)
    for i, r in enumerate(sorted_rows[:5], 1):
        print(f"第 {i} 名: 規模 {r['LocalMagnitude']} | 時間: {r['OriginTime']} | 經度: {r['EpicenterLongitude']} | 緯度: {r['EpicenterLatitude']} | 深度: {r['FocalDepth']} km | Quality: {r['Quality']} | ReviewStatus: {r['ReviewStatus']}")

    print("\n" + "=" * 70)
    print("【7. 1999 年最大地震核對】")
    r_1999 = [r for r in all_rows if r['Year'] == '1999']
    top_1999 = max(r_1999, key=lambda r: r['_mag_val'])
    print(f"1999年最大一筆: 時間 {top_1999['OriginTime']} | 經度: {top_1999['EpicenterLongitude']} | 緯度: {top_1999['EpicenterLatitude']} | 深度: {top_1999['FocalDepth']} km | 規模: {top_1999['LocalMagnitude']}")
    print("=" * 70)

if __name__ == '__main__':
    main()
