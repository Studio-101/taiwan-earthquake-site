/**
 * ==============================================================================
 * 台灣地震 3D 空間分佈視覺化 (1990–2025)
 * ==============================================================================
 * 
 * 核心功能：
 * 1. 座標轉換：將經度、緯度、震源深度依等距柱狀投影轉換為 3D 空間座標 (公里)。
 * 2. 真實比例：水平與垂直方向均為 1:1 真實比例，無垂直誇大。
 * 3. 點雲繪製：以 THREE.Points 一次繪製約 7 萬筆真實地震點，自訂 Shader 呈現抗鋸齒圓點。
 * 4. 樣式映射：顏色依深度分級，圓點直徑依芮氏規模分級。
 * 5. 海岸線底圖：在深度 0 km 海平面繪製台灣海岸線與縣市邊界。
 * 6. 視角切換：提供「俯視」、「從東側看（隱沒帶）」、「從南側看」三種專業視角。
 */

// ==============================================================================
// 1. 座標換算函式與參數定義
// ==============================================================================

/**
 * 投影參考參數：
 * - 投影方式：等距柱狀投影 (Equirectangular Projection / Plate Carrée with cosine latitude weighting)
 * - 投影中心點：經度 121.0°E, 緯度 23.5°N（台灣地理中心近似位置）
 * - 地球半徑：WGS-84 平均半徑 R = 6,371.0 km
 * 
 * 軸向定義：
 * - X 軸：東 (+) / 西 (-) [公里]
 * - Y 軸：高度 (+) / 深度 (-) [公里]，海平面 Y = 0，震源深度 FocalDepth 映射為 Y = -FocalDepth
 * - Z 軸：南 (+) / 北 (-) [公里]，北向為 -Z（在 Three.js 俯視時朝向螢幕上方）
 */
const CENTER_LON = 121.0;
const CENTER_LAT = 23.5;
const EARTH_RADIUS_KM = 6371.0;
const DEG_TO_RAD = Math.PI / 180.0;

// 每度緯度對應之公里數 (約 111.195 km)
const LAT_KM_PER_DEG = EARTH_RADIUS_KM * DEG_TO_RAD;

// 在緯度 23.5°N 處，每度經度對應之公里數 (約 101.973 km)
const LON_KM_PER_DEG = EARTH_RADIUS_KM * DEG_TO_RAD * Math.cos(CENTER_LAT * DEG_TO_RAD);

/**
 * 將經度、緯度、深度轉換為 3D 空間座標（單位：公里）
 * @param {number} lon - 經度 (度)
 * @param {number} lat - 緯度 (度)
 * @param {number} depth - 震源深度 (公里)
 * @returns {{x: number, y: number, z: number}} 3D 座標 (公里)
 */
function convertCoordinates(lon, lat, depth) {
  // 公式說明：
  // X = (lon - CENTER_LON) * 經度每度公里數
  // Y = -depth (向地底延伸，單位公里，與水平 1:1 等比例)
  // Z = -(lat - CENTER_LAT) * 緯度每度公里數 (以 -Z 代表北方)
  const x = (lon - CENTER_LON) * LON_KM_PER_DEG;
  const y = -depth;
  const z = -(lat - CENTER_LAT) * LAT_KM_PER_DEG;
  return { x, y, z };
}

// 共同涵蓋範圍 (所有年份共同具備之範圍)
const COMMON_BOUNDS = {
  minLon: 119.0,
  maxLon: 123.0,
  minLat: 21.0,
  maxLat: 26.0
};

/**
 * 地形頂點座標換算函式
 * 依據專案規範第 5 條：座標換算、比例、誇大倍率寫成獨立函式並加註解說明公式。
 * 
 * 公式說明：
 * 1. 水平座標 (X, Z)：與地震點完全一致之等距柱狀投影（單位：公里）
 *    X = (lon - CENTER_LON) * LON_KM_PER_DEG
 *    Z = -(lat - CENTER_LAT) * LAT_KM_PER_DEG
 * 2. 垂直座標 (Y)：
 *    原始高程 (公尺) 轉為公里：elevKm = elevMeters / 1000.0
 *    地形垂直誇大倍率：5.0 倍
 *    Y = elevKm * 5.0（正值為海平面以上陸地山脈，負值為海平面以下海底水深）
 *    注意：此誇大倍率僅套用於地貌起伏，絕不可套用於地震深度。
 */
const TERRAIN_EXAGGERATION = 5.0;

function convertTerrainCoordinate(lon, lat, elevMeters) {
  const x = (lon - CENTER_LON) * LON_KM_PER_DEG;
  const y = (elevMeters / 1000.0) * TERRAIN_EXAGGERATION;
  const z = -(lat - CENTER_LAT) * LAT_KM_PER_DEG;
  return { x, y, z };
}

/**
 * 地形高程著色函式 (Hypsometric & Bathymetric Tinting)
 * 根據真實高程（公尺）平滑映射出深海海溝、大陸棚、沿海平原至高山主脊之真實自然配色
 * @param {number} elev - 高程（公尺，負值為海深，正值為海拔）
 * @returns {[number, number, number]} RGB 陣列 (0.0 ~ 1.0)
 */
function getTerrainColor(elev) {
  if (elev < -4000) {
    // 琉球海溝深淵 (-6800m ~ -4000m): 極深暗靛青色
    const t = Math.min(1.0, Math.max(0.0, (elev - (-6800)) / 2800));
    return [0.03 + 0.02 * t, 0.08 + 0.05 * t, 0.18 + 0.08 * t];
  } else if (elev < -1500) {
    // 深海盆與大陸斜坡 (-4000m ~ -1500m): 深藍靛色
    const t = (elev - (-4000)) / 2500;
    return [0.05 + 0.05 * t, 0.13 + 0.10 * t, 0.26 + 0.12 * t];
  } else if (elev < -200) {
    // 大陸棚邊緣斜坡 (-1500m ~ -200m): 沉穩青藍色
    const t = (elev - (-1500)) / 1300;
    return [0.10 + 0.06 * t, 0.23 + 0.12 * t, 0.38 + 0.10 * t];
  } else if (elev < 0) {
    // 淺海大陸棚與台灣海峽 (-200m ~ 0m): 淺青碧藍色
    const t = (elev - (-200)) / 200;
    return [0.16 + 0.06 * t, 0.35 + 0.12 * t, 0.48 + 0.08 * t];
  } else if (elev < 200) {
    // 沿海平原與丘陵 (0m ~ 200m): 濃郁深苔綠色
    const t = elev / 200;
    return [0.18 + 0.08 * t, 0.36 + 0.08 * t, 0.16 + 0.05 * t];
  } else if (elev < 1000) {
    // 低中海拔森林 (200m ~ 1000m): 茂密森林深綠
    const t = (elev - 200) / 800;
    return [0.26 + 0.14 * t, 0.44 + 0.06 * t, 0.21 + 0.05 * t];
  } else if (elev < 2200) {
    // 中高海拔山區 (1000m ~ 2200m): 橄欖褐色過渡
    const t = (elev - 1000) / 1200;
    return [0.40 + 0.18 * t, 0.50 + 0.05 * t, 0.26 + 0.06 * t];
  } else if (elev < 3000) {
    // 高山針葉林與碎石岩壁 (2200m ~ 3000m): 暖岩石棕褐色
    const t = (elev - 2200) / 800;
    return [0.58 + 0.15 * t, 0.55 + 0.10 * t, 0.32 + 0.15 * t];
  } else {
    // 中央山脈百岳與玉山主脊 (3000m ~ 3765m): 岩灰冷峰
    const t = Math.min(1.0, (elev - 3000) / 765);
    return [0.73 + 0.15 * t, 0.65 + 0.20 * t, 0.47 + 0.35 * t];
  }
}

// ==============================================================================
// 2. 深度著色與規模尺寸映射函式
// ==============================================================================

/**
 * 依深度決定 RGB 顏色
 * 分級標準（高對比度配色）：
 * 0 - 30 km:  極淺層 (鮮明紅色 #ff1744)
 * 30 - 70 km: 淺層 (鮮明亮黃色 #ffea00，與紅色形成極高對比，點密集時極易辨識)
 * 70 - 150 km: 中深層 (翠綠色 #00e676)
 * >= 150 km:  深層隱沒帶 (亮藍色 #00b0ff)
 */
function getDepthColor(depth) {
  if (depth < 30.0) {
    return [1.0, 0.09, 0.27];     // 鮮明紅色 #ff1744
  } else if (depth < 70.0) {
    return [1.0, 0.92, 0.0];      // 鮮明亮黃色 #ffea00 (徹底解決紅橘混淆問題)
  } else if (depth < 150.0) {
    return [0.0, 0.90, 0.46];     // 翠綠色 #00e676
  } else {
    return [0.0, 0.69, 1.0];      // 亮藍色 #00b0ff
  }
}

/**
 * 依芮氏規模決定圓點基準像素大小
 */
function getMagnitudeSize(mag) {
  if (mag < 4.0) {
    return 3.5;
  } else if (mag < 5.0) {
    return 6.0;
  } else if (mag < 6.0) {
    return 9.5;
  } else {
    return 15.0;
  }
}

// ==============================================================================
// 3. Three.js 場景設置與全域狀態
// ==============================================================================

let scene, camera, renderer, controls;
let pointsMesh = null;
let coastlineMesh = null;
let boundsMesh = null;
let gridMesh = null;

// 地形網格與掀開狀態
let terrainMesh = null;
let terrainGroup = null;
let terrainGuideLines = null;
let terrainData = null;
const MAX_LIFT_KM = 80.0; // 掀開最大抬升高度 (80 km)

let allEarthquakes = [];
let commonRangeOnly = true;

// 第四階段：時間、規模、Quality 篩選狀態
let currentMaxYear = 2025; // 逐年累積截止年份 (1990–2025)
let minMagnitude = 3.0;    // 芮氏規模下限 (預設全部 3.0)
let selectedQualities = new Set(['A', 'B', 'C', 'D']); // Quality 等級篩選 (預設全選)
let isPlayingYears = false; // 是否正在逐年累積播放中
let playTimer = null;       // 逐年播放計時器

// 第四階段：Raycaster 點擊拾取與高亮標記
let raycaster = null;
let mousePos = new THREE.Vector2();
let pointerDownPos = { x: 0, y: 0 };
let selectedMarkerMesh = null; // 3D 選中點之高亮光圈
let currentSelectedEq = null;

// 第四階段：白話說明卡片（3 張主題解說，底部標註權威出處）
const explainCardsData = [
  {
    title: "宜蘭外海：鑽進地底的板塊溜滑梯",
    content: "仔細看台灣東北部外海（點右側「從東側看」），地震點從海面附近的紅色，越往北越深（黃色、綠色），最後一路插到地底 200～300 公里的深藍色！這是因為「菲律賓海板塊」在這裡像溜滑梯一樣，斜斜地插進歐亞板塊肚子底下，摩擦破裂排出了一道壯觀的斜坡。",
    source: "資料出處：交通部中央氣象署地震測報中心《台灣之板塊構造與地震活動》"
  },
  {
    title: "台灣本島：正面硬撞撞出中央山脈",
    content: "轉到南側看台灣本島（點右側「從南側看」），會發現地震幾乎全擠在地表 30 公里以內（整片通紅）！在台灣中南部，兩大板塊誰也鑽不進對方底下，只能正面硬碰硬互撞，把地殼向上擠壓隆起，撞出了高聳的中央山脈，也造就了 921 等地表淺層強震。",
    source: "資料出處：經濟部地質調查及礦業研究中心《台灣地質與活動斷層》"
  },
  {
    title: "掀開地表：透視地底的真實深度",
    content: "平時我們腳踩的台灣陸地與山脈，高度最多只有 3～4 公里，但地底地震的深度卻動輒幾十到上百公里。向上掀開地表外殼，就像揭開千層派的表皮，能擺脫地形遮蔽，看清深淺震源在地底交織的立體骨架。",
    source: "資料出處：國家科學及技術委員會《科技大觀園：透視台灣地下構造》"
  }
];
let currentExplainIndex = 0;

// 統計資訊元素
const statDisplayed = document.getElementById('stat-displayed-points');
const statTotal = document.getElementById('stat-total-points');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingDetail = document.getElementById('loading-detail');

// ==============================================================================
// 4. 自訂 Shader 頂點與片段著色器（繪製高畫質平滑圓點粒子）
// ==============================================================================

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aVisible;
  varying vec3 vColor;
  varying float vVisible;

  void main() {
    vColor = aColor;
    vVisible = aVisible;
    if (aVisible < 0.5) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // 移出場景外
      return;
    }
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // 依相機距離微調粒子透視大小，並設定合理範圍
    gl_PointSize = aSize * (350.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 36.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vVisible;

  void main() {
    if (vVisible < 0.5) discard;
    // 圓形粒子距離計算
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    // 邊緣柔化抗鋸齒
    float alpha = smoothstep(0.5, 0.38, dist);
    gl_FragColor = vec4(vColor, alpha * 0.90);
  }
`;

// ==============================================================================
// 5. 初始化 3D 視圖與控制器
// ==============================================================================

function initThree() {
  const container = document.getElementById('canvas-container');
  const width = window.innerWidth;
  const height = window.innerHeight;

  // 場景
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f17);

  // 相機：世界座標向上方向永遠固定為 (0, 1, 0)（海平面至天空）
  camera = new THREE.PerspectiveCamera(45, width / height, 1, 3000);
  camera.up.set(0, 1, 0);

  // 預設俯視：相機置於 (0, 520, 0.001)，微偏南 0.001 km，視線向北 (-Z)，北向自然朝向螢幕上方且無奇異點
  camera.position.set(0, viewDistance(520), 0.001);

  // 渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // 加上柔和光照以呈現 3D 地表山脈與海溝立體陰影
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
  dirLight.position.set(-250, 450, -350); // 西北向光源，自然突顯中央山脈與海溝稜線
  scene.add(dirLight);

  // OrbitControls 軌道控制器：固定向上為 (0, 1, 0)，確保滑鼠操作完全符合人體工學
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);
  controls.maxDistance = 1500;
  controls.minDistance = 20;

  // 視窗縮放事件
  window.addEventListener('resize', onWindowResize);

  // 初始化 Raycaster 與選中標記 (第四階段：點擊單一地震)
  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 5.0; // 3D 空間拾取閾值 (公里)
  createSelectedMarker();

  // 監聽畫布點擊事件（區分視角拖曳與單擊）
  renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDownPos.x = e.clientX;
    pointerDownPos.y = e.clientY;
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    const dx = e.clientX - pointerDownPos.x;
    const dy = e.clientY - pointerDownPos.y;
    if (Math.hypot(dx, dy) < 6) {
      onCanvasClick(e);
    }
  });

  // 建立輔助線框與網格
  createBoundsAndGrid();

  // 綁定 UI 事件
  setupUIEvents();

  // 開始動畫迴圈
  animate();
}

function createSelectedMarker() {
  // 建立醒目的雙層發光圓環標記
  const group = new THREE.Group();

  const ringGeom = new THREE.RingGeometry(2.5, 4.5, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
  });
  const ringMesh = new THREE.Mesh(ringGeom, ringMat);
  group.add(ringMesh);

  const dotGeom = new THREE.CircleGeometry(1.2, 16);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffea00,
    side: THREE.DoubleSide
  });
  const dotMesh = new THREE.Mesh(dotGeom, dotMat);
  group.add(dotMesh);

  selectedMarkerMesh = group;
  selectedMarkerMesh.visible = false;
  selectedMarkerMesh.renderOrder = 20;
  scene.add(selectedMarkerMesh);
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // 若有選中地震點，使標記持續面向相機並呈現呼吸微動
  if (selectedMarkerMesh && selectedMarkerMesh.visible) {
    selectedMarkerMesh.quaternion.copy(camera.quaternion);
    const pulse = 1.0 + 0.15 * Math.sin(Date.now() * 0.006);
    selectedMarkerMesh.scale.set(pulse, pulse, pulse);
  }

  renderer.render(scene, camera);
}

// ==============================================================================
// 6. 建立共同範圍外框與地底深度刻度網格
// ==============================================================================

function createBoundsAndGrid() {
  const b = COMMON_BOUNDS;
  const c1 = convertCoordinates(b.minLon, b.minLat, 0);
  const c2 = convertCoordinates(b.maxLon, b.minLat, 0);
  const c3 = convertCoordinates(b.maxLon, b.maxLat, 0);
  const c4 = convertCoordinates(b.minLon, b.maxLat, 0);

  const group = new THREE.Group();

  // 1. 深度 0 km（海平面）共同範圍矩形外框
  const surfacePoints = [
    new THREE.Vector3(c1.x, 0, c1.z),
    new THREE.Vector3(c2.x, 0, c2.z),
    new THREE.Vector3(c2.x, 0, c2.z),
    new THREE.Vector3(c3.x, 0, c3.z),
    new THREE.Vector3(c3.x, 0, c3.z),
    new THREE.Vector3(c4.x, 0, c4.z),
    new THREE.Vector3(c4.x, 0, c4.z),
    new THREE.Vector3(c1.x, 0, c1.z),
  ];

  const surfaceGeom = new THREE.BufferGeometry().setFromPoints(surfacePoints);
  const surfaceMat = new THREE.LineBasicMaterial({
    color: 0x64b5f6,
    linewidth: 2,
    transparent: true,
    opacity: 0.85
  });
  const surfaceLine = new THREE.LineSegments(surfaceGeom, surfaceMat);
  group.add(surfaceLine);

  // 2. 地底立方體邊框（延伸至深度 300 km）
  const maxDepth = 300;
  const boxPoints = [
    // 四個垂直柱子
    new THREE.Vector3(c1.x, 0, c1.z), new THREE.Vector3(c1.x, -maxDepth, c1.z),
    new THREE.Vector3(c2.x, 0, c2.z), new THREE.Vector3(c2.x, -maxDepth, c2.z),
    new THREE.Vector3(c3.x, 0, c3.z), new THREE.Vector3(c3.x, -maxDepth, c3.z),
    new THREE.Vector3(c4.x, 0, c4.z), new THREE.Vector3(c4.x, -maxDepth, c4.z),
    // 底部矩形 (-300 km)
    new THREE.Vector3(c1.x, -maxDepth, c1.z), new THREE.Vector3(c2.x, -maxDepth, c2.z),
    new THREE.Vector3(c2.x, -maxDepth, c2.z), new THREE.Vector3(c3.x, -maxDepth, c3.z),
    new THREE.Vector3(c3.x, -maxDepth, c3.z), new THREE.Vector3(c4.x, -maxDepth, c4.z),
    new THREE.Vector3(c4.x, -maxDepth, c4.z), new THREE.Vector3(c1.x, -maxDepth, c1.z),
  ];

  const boxGeom = new THREE.BufferGeometry().setFromPoints(boxPoints);
  const boxMat = new THREE.LineBasicMaterial({
    color: 0x334155,
    transparent: true,
    opacity: 0.5
  });
  group.add(new THREE.LineSegments(boxGeom, boxMat));

  // 3. 深度參考網格層 (每 50 km 一層虛線網格)
  const depths = [50, 100, 150, 200, 250];
  const gridPoints = [];
  depths.forEach(d => {
    gridPoints.push(
      new THREE.Vector3(c1.x, -d, c1.z), new THREE.Vector3(c2.x, -d, c2.z),
      new THREE.Vector3(c2.x, -d, c2.z), new THREE.Vector3(c3.x, -d, c3.z),
      new THREE.Vector3(c3.x, -d, c3.z), new THREE.Vector3(c4.x, -d, c4.z),
      new THREE.Vector3(c4.x, -d, c4.z), new THREE.Vector3(c1.x, -d, c1.z)
    );
  });
  const depthGridGeom = new THREE.BufferGeometry().setFromPoints(gridPoints);
  const depthGridMat = new THREE.LineBasicMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.45
  });
  group.add(new THREE.LineSegments(depthGridGeom, depthGridMat));

  boundsMesh = group;
  scene.add(boundsMesh);
}

// ==============================================================================
// 7. 載入並繪製台灣海岸線 (深度 0 平面)
// ==============================================================================

async function loadCoastline() {
  loadingDetail.innerText = '正在讀取台灣海岸線與縣市邊界圖資...';
  try {
    const res = await fetch('data/taiwan_coastline.geojson.json');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const geojson = await res.json();

    const linePoints = [];

    // 解析 GeoJSON 幾何特徵 (Polygon 與 MultiPolygon)
    geojson.features.forEach(feature => {
      const geom = feature.geometry;
      if (!geom) return;

      const addRing = (ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const pt1 = convertCoordinates(ring[i][0], ring[i][1], 0);
          const pt2 = convertCoordinates(ring[i + 1][0], ring[i + 1][1], 0);
          linePoints.push(new THREE.Vector3(pt1.x, 0, pt1.z));
          linePoints.push(new THREE.Vector3(pt2.x, 0, pt2.z));
        }
      };

      if (geom.type === 'Polygon') {
        geom.coordinates.forEach(addRing);
      } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(polygon => {
          polygon.forEach(addRing);
        });
      }
    });

    const geom = new THREE.BufferGeometry().setFromPoints(linePoints);
    const mat = new THREE.LineBasicMaterial({
      color: 0x93c5fd, // 柔和高對比淺藍色
      linewidth: 1.5,
      transparent: true,
      opacity: 0.8
    });

    coastlineMesh = new THREE.LineSegments(geom, mat);
    scene.add(coastlineMesh);
  } catch (err) {
    console.warn('載入海岸線失敗或檔案未備妥:', err);
  }
}

// ==============================================================================
// 7.5. 載入並建立 3D 地形與海底水深立體模型 (5 倍誇大) 及四角掀開引線
// ==============================================================================

function createTerrainGuideLines() {
  const b = COMMON_BOUNDS;
  const c1 = convertCoordinates(b.minLon, b.minLat, 0);
  const c2 = convertCoordinates(b.maxLon, b.minLat, 0);
  const c3 = convertCoordinates(b.maxLon, b.maxLat, 0);
  const c4 = convertCoordinates(b.minLon, b.maxLat, 0);

  // 四根垂直柱子引線，初始端點在海平面 Y = 0
  const points = [
    new THREE.Vector3(c1.x, 0, c1.z), new THREE.Vector3(c1.x, 0, c1.z),
    new THREE.Vector3(c2.x, 0, c2.z), new THREE.Vector3(c2.x, 0, c2.z),
    new THREE.Vector3(c3.x, 0, c3.z), new THREE.Vector3(c3.x, 0, c3.z),
    new THREE.Vector3(c4.x, 0, c4.z), new THREE.Vector3(c4.x, 0, c4.z)
  ];

  const geom = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({
    color: 0x38bdf8,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.65
  });

  terrainGuideLines = new THREE.LineSegments(geom, mat);
  terrainGuideLines.computeLineDistances();
  terrainGuideLines.visible = false;
  scene.add(terrainGuideLines);
}

function updateTerrainLift(percent) {
  if (!terrainGroup) return;
  const liftKm = (percent / 100.0) * MAX_LIFT_KM;
  terrainGroup.position.y = liftKm;

  // 更新介面數值標籤
  const label = document.getElementById('val-lift-height');
  if (label) {
    label.innerText = `${Math.round(liftKm)} km`;
  }

  // 更新四角引線
  if (terrainGuideLines) {
    const posAttr = terrainGuideLines.geometry.getAttribute('position');
    const arr = posAttr.array;
    // 每根線第 2 個頂點 (索引 1, 3, 5, 7) 的 Y 座標設為 liftKm
    arr[4]  = liftKm; // c1 top Y
    arr[10] = liftKm; // c2 top Y
    arr[16] = liftKm; // c3 top Y
    arr[22] = liftKm; // c4 top Y
    posAttr.needsUpdate = true;
    terrainGuideLines.computeLineDistances();
    terrainGuideLines.visible = liftKm > 0.5;
  }
}

function updateTerrainOpacity(percent) {
  if (!terrainMesh) return;
  const opacity = percent / 100.0;
  terrainMesh.material.transparent = true;
  terrainMesh.material.opacity = opacity;
  // 當完全不透明時啟用 depthWrite，半透明時關閉以利透視下方點雲
  terrainMesh.material.depthWrite = (opacity >= 0.98);
  terrainMesh.material.needsUpdate = true;

  const label = document.getElementById('val-terrain-opacity');
  if (label) {
    label.innerText = `${Math.round(percent)}%`;
  }
}

async function loadTerrain() {
  loadingDetail.innerText = '正在讀取 data/terrain_grid.json (72,000 點真實地形水深)...';
  try {
    const res = await fetch('data/terrain_grid.json');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    terrainData = await res.json();

    const w = terrainData.width;
    const h = terrainData.height;
    const minLon = terrainData.minLon;
    const maxLon = terrainData.maxLon;
    const minLat = terrainData.minLat;
    const maxLat = terrainData.maxLat;
    const elevs = terrainData.elevations;

    const numVertices = w * h;
    const positions = new Float32Array(numVertices * 3);
    const colors = new Float32Array(numVertices * 3);

    let vIdx = 0;
    for (let r = 0; r < h; r++) {
      const lat = maxLat - (r / (h - 1)) * (maxLat - minLat);
      for (let c = 0; c < w; c++) {
        const lon = minLon + (c / (w - 1)) * (maxLon - minLon);
        const elev = elevs[r * w + c];

        const coord = convertTerrainCoordinate(lon, lat, elev);
        const col = getTerrainColor(elev);

        positions[vIdx * 3]     = coord.x;
        positions[vIdx * 3 + 1] = coord.y;
        positions[vIdx * 3 + 2] = coord.z;

        colors[vIdx * 3]     = col[0];
        colors[vIdx * 3 + 1] = col[1];
        colors[vIdx * 3 + 2] = col[2];

        vIdx++;
      }
    }

    // 建立三角形索引陣列 (w-1) * (h-1) * 2 個三角形
    const numIndices = (w - 1) * (h - 1) * 6;
    const indices = new Uint32Array(numIndices);
    let iIdx = 0;
    for (let r = 0; r < h - 1; r++) {
      for (let c = 0; c < w - 1; c++) {
        const i0 = r * w + c;
        const i1 = r * w + (c + 1);
        const i2 = (r + 1) * w + c;
        const i3 = (r + 1) * w + (c + 1);

        indices[iIdx++] = i0;
        indices[iIdx++] = i2;
        indices[iIdx++] = i1;

        indices[iIdx++] = i1;
        indices[iIdx++] = i2;
        indices[iIdx++] = i3;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.05,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1.0,
      depthWrite: true
    });

    terrainMesh = new THREE.Mesh(geom, mat);
    terrainMesh.renderOrder = 1;

    // 建立地形群組 (便於整體抬升掀開)
    terrainGroup = new THREE.Group();
    terrainGroup.add(terrainMesh);
    scene.add(terrainGroup);

    // 建立四角半透明垂直引線
    createTerrainGuideLines();

  } catch (err) {
    console.error('載入地形資料失敗:', err);
  }
}

// ==============================================================================
// 8. 載入並繪製地震 CSV 點雲
// ==============================================================================

async function loadEarthquakes() {
  loadingDetail.innerText = '正在讀取 data/earthquakes.csv (73,729 筆真實地震)...';
  const res = await fetch('data/earthquakes.csv');
  if (!res.ok) throw new Error(`無法載入 earthquakes.csv: ${res.status}`);
  const csvText = await res.text();

  loadingDetail.innerText = '解析地震數值並計算 3D 空間座標...';

  // 解析 CSV
  const lines = csvText.trim().split('\n');
  const header = lines[0].split(',').map(s => s.trim());
  const yearIdx = header.indexOf('Year');
  const timeIdx = header.indexOf('OriginTime');
  const lonIdx = header.indexOf('EpicenterLongitude');
  const latIdx = header.indexOf('EpicenterLatitude');
  const depthIdx = header.indexOf('FocalDepth');
  const magIdx = header.indexOf('LocalMagnitude');
  const qualityIdx = header.indexOf('Quality');

  const total = lines.length - 1;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const visibles = new Float32Array(total);

  allEarthquakes = [];

  for (let i = 1; i <= total; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');

    const year = parseInt(parts[yearIdx], 10);
    const originTime = parts[timeIdx];
    const lon = parseFloat(parts[lonIdx]);
    const lat = parseFloat(parts[latIdx]);
    const depth = parseFloat(parts[depthIdx]);
    const mag = parseFloat(parts[magIdx]);
    const quality = parts[qualityIdx] ? parts[qualityIdx].trim() : '';

    const coord = convertCoordinates(lon, lat, depth);
    const color = getDepthColor(depth);
    const size = getMagnitudeSize(mag);

    // 判斷是否在共同範圍內 (119–123°E, 21–26°N)
    const inCommon = (
      lon >= COMMON_BOUNDS.minLon && lon <= COMMON_BOUNDS.maxLon &&
      lat >= COMMON_BOUNDS.minLat && lat <= COMMON_BOUNDS.maxLat
    );

    const idx = i - 1;
    positions[idx * 3]     = coord.x;
    positions[idx * 3 + 1] = coord.y;
    positions[idx * 3 + 2] = coord.z;

    colors[idx * 3]     = color[0];
    colors[idx * 3 + 1] = color[1];
    colors[idx * 3 + 2] = color[2];

    sizes[idx] = size;
    visibles[idx] = inCommon ? 1.0 : 0.0;

    // 保留真實完整欄位供點選與篩選查詢
    allEarthquakes.push({
      index: idx,
      year,
      originTime,
      lon,
      lat,
      depth,
      mag,
      quality,
      inCommon,
      x: coord.x,
      y: coord.y,
      z: coord.z
    });
  }

  // 建立點雲 BufferGeometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aVisible', new THREE.BufferAttribute(visibles, 1));

  // ShaderMaterial
  const material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    depthWrite: false
  });

  pointsMesh = new THREE.Points(geometry, material);
  pointsMesh.renderOrder = 2; // 讓點雲在半透明地形中保持清晰透視
  scene.add(pointsMesh);

  // 更新介面計數
  statTotal.innerText = `${total.toLocaleString()} 筆`;

  // 套用初始所有篩選狀態
  applyFilters();

  // 隱藏載入中畫面
  loadingOverlay.style.opacity = '0';
  setTimeout(() => {
    loadingOverlay.style.display = 'none';
  }, 500);
}

// ==============================================================================
// 9. 多維度綜合篩選函式（時間、規模、Quality、共同範圍）
// ==============================================================================

function isEarthquakeVisible(eq) {
  if (commonRangeOnly && !eq.inCommon) return false;
  if (eq.year > currentMaxYear) return false;
  if (eq.mag < minMagnitude) return false;
  if (!selectedQualities.has(eq.quality)) return false;
  return true;
}

function applyFilters() {
  if (!pointsMesh) return;
  const visibleAttr = pointsMesh.geometry.getAttribute('aVisible');
  const arr = visibleAttr.array;

  let count = 0;
  for (let i = 0; i < allEarthquakes.length; i++) {
    const eq = allEarthquakes[i];
    const isVisible = isEarthquakeVisible(eq);
    arr[i] = isVisible ? 1.0 : 0.0;
    if (isVisible) count++;
  }

  visibleAttr.needsUpdate = true;
  statDisplayed.innerText = `${count.toLocaleString()} 筆`;

  // 若目前選取的地震點不符合當前篩選條件，關閉詳細資訊卡與隱藏 3D 標記
  if (currentSelectedEq && !isEarthquakeVisible(currentSelectedEq)) {
    closeDetailCard();
  }
}

// ==============================================================================
// 9.1. 年份逐年累積播放邏輯
// ==============================================================================

function updateYearDisplay() {
  const slider = document.getElementById('slider-year');
  const label = document.getElementById('val-year-display');
  if (slider) slider.value = currentMaxYear;
  if (label) {
    if (currentMaxYear === 2025) {
      label.innerText = '1990 – 2025 (全部)';
    } else {
      label.innerText = `1990 – ${currentMaxYear}`;
    }
  }
}

function startPlayingYears() {
  if (currentMaxYear >= 2025) {
    currentMaxYear = 1990;
  }
  isPlayingYears = true;
  const playBtnText = document.getElementById('play-btn-text');
  const btnPlay = document.getElementById('btn-play-years');
  if (playBtnText) playBtnText.innerText = '⏸ 暫停播放';
  if (btnPlay) btnPlay.classList.add('playing');

  updateYearDisplay();
  applyFilters();

  playTimer = setInterval(() => {
    if (currentMaxYear < 2025) {
      currentMaxYear++;
      updateYearDisplay();
      applyFilters();
    } else {
      stopPlayingYears();
    }
  }, 650);
}

function stopPlayingYears() {
  isPlayingYears = false;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  const playBtnText = document.getElementById('play-btn-text');
  const btnPlay = document.getElementById('btn-play-years');
  if (playBtnText) playBtnText.innerText = '▶ 播放逐年累積';
  if (btnPlay) btnPlay.classList.remove('playing');
}

// ==============================================================================
// 9.2. Raycaster 點擊單一地震點顯示原始資料
// ==============================================================================

function onCanvasClick(e) {
  if (!pointsMesh || allEarthquakes.length === 0) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mousePos.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mousePos.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mousePos, camera);
  const intersects = raycaster.intersectObject(pointsMesh);

  if (intersects.length > 0) {
    const visibleAttr = pointsMesh.geometry.getAttribute('aVisible');
    // 找出距離相機最近且處於可見狀態的點
    for (let hit of intersects) {
      const idx = hit.index;
      if (idx !== undefined && visibleAttr.array[idx] > 0.5) {
        showEarthquakeDetail(allEarthquakes[idx]);
        return;
      }
    }
  }
}

function showEarthquakeDetail(eq) {
  currentSelectedEq = eq;

  // 格式化發震時間 (將 ISO 字串轉為友善格式，保留官方原始紀錄)
  let formattedTime = eq.originTime;
  if (formattedTime.includes('T')) {
    formattedTime = formattedTime.replace('T', ' ').replace('+08:00', '');
  }

  // 更新卡片內容（全部取自 CSV 真實數值，絕無推估假資料）
  document.getElementById('detail-mag').innerText = `M ${eq.mag.toFixed(1)}`;
  document.getElementById('detail-time').innerText = formattedTime;
  document.getElementById('detail-depth').innerText = `${eq.depth.toFixed(1)} 公里`;
  document.getElementById('detail-lon').innerText = `${eq.lon.toFixed(3)}°E`;
  document.getElementById('detail-lat').innerText = `${eq.lat.toFixed(3)}°N`;
  document.getElementById('detail-quality').innerText = eq.quality ? `等級 ${eq.quality}` : '未標示';

  // 顯示資訊卡
  const card = document.getElementById('earthquake-detail-card');
  if (card) card.style.display = 'block';

  // 將 3D 高亮標記移至該點座標
  if (selectedMarkerMesh) {
    selectedMarkerMesh.position.set(eq.x, eq.y, eq.z);
    selectedMarkerMesh.visible = true;
  }
}

function closeDetailCard() {
  const card = document.getElementById('earthquake-detail-card');
  if (card) card.style.display = 'none';
  if (selectedMarkerMesh) selectedMarkerMesh.visible = false;
  currentSelectedEq = null;
}

// ==============================================================================
// 9.3. 白話說明卡片排版與翻頁邏輯
// ==============================================================================

function renderExplainCard() {
  const data = explainCardsData[currentExplainIndex];
  if (!data) return;
  document.getElementById('explain-title').innerText = data.title;
  document.getElementById('explain-content').innerText = data.content;
  document.getElementById('explain-source').innerText = data.source;
  document.getElementById('explain-page').innerText = `${currentExplainIndex + 1} / ${explainCardsData.length}`;
}

// ==============================================================================
// 10. 視角切換與 UI 事件綁定
// ==============================================================================

// 直式手機畫面較窄，相機拉遠以容納整個資料範圍；橫式畫面維持原距離
function viewDistance(distance) {
  return distance * Math.max(1, 0.8 / camera.aspect);
}

function setView(viewType) {
  document.querySelectorAll('.view-btn-group .btn').forEach(b => b.classList.remove('active'));

  // 確保世界向上向量固定為 (0, 1, 0)，維持 OrbitControls 的球座標系統一致且滑鼠操作方向完全自然
  camera.up.set(0, 1, 0);

  if (viewType === 'top') {
    // 俯視 (置於上方 520 km，微偏南 0.001 km，視線向北 -Z，北向自然朝上且無奇異點)
    document.getElementById('btn-view-top').classList.add('active');
    controls.target.set(0, 0, 0);
    camera.position.set(0, viewDistance(520), 0.001);
  } else if (viewType === 'east') {
    // 從東側看 (觀察太平洋板塊向北隱沒帶斜插地底)
    document.getElementById('btn-view-east').classList.add('active');
    controls.target.set(0, -75, 0);
    camera.position.set(viewDistance(580), -75, 0);
  } else if (viewType === 'south') {
    // 從南側看 (觀察碰撞帶形狀)
    document.getElementById('btn-view-south').classList.add('active');
    controls.target.set(0, -75, 0);
    camera.position.set(0, -75, viewDistance(580));
  }
  controls.update();
}

function setupUIEvents() {
  // 視角按鈕
  document.getElementById('btn-view-top').addEventListener('click', () => setView('top'));
  document.getElementById('btn-view-east').addEventListener('click', () => setView('east'));
  document.getElementById('btn-view-south').addEventListener('click', () => setView('south'));

  // 第四階段：年份滑桿與播放控制
  const sliderYear = document.getElementById('slider-year');
  if (sliderYear) {
    sliderYear.addEventListener('input', (e) => {
      stopPlayingYears();
      currentMaxYear = parseInt(e.target.value, 10);
      updateYearDisplay();
      applyFilters();
    });
  }

  const btnPlayYears = document.getElementById('btn-play-years');
  if (btnPlayYears) {
    btnPlayYears.addEventListener('click', () => {
      if (isPlayingYears) {
        stopPlayingYears();
      } else {
        startPlayingYears();
      }
    });
  }

  const btnResetYears = document.getElementById('btn-reset-years');
  if (btnResetYears) {
    btnResetYears.addEventListener('click', () => {
      stopPlayingYears();
      currentMaxYear = 2025;
      updateYearDisplay();
      applyFilters();
    });
  }

  // 第四階段：芮氏規模按鈕群組篩選
  const magBtns = document.querySelectorAll('.mag-btn');
  magBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      magBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      minMagnitude = parseFloat(btn.dataset.mag);
      applyFilters();
    });
  });

  // 第四階段：Quality 等級篩選（遵守規則：說明文字只寫「依資料中的 Quality 欄位篩選」，不要解釋 A～D 的意義）
  const qualityCheckboxes = document.querySelectorAll('.quality-checkbox');
  qualityCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      selectedQualities.clear();
      qualityCheckboxes.forEach(box => {
        if (box.checked) selectedQualities.add(box.value);
      });
      applyFilters();
    });
  });

  // 第四階段：地震詳細卡片關閉按鈕
  const btnCloseDetail = document.getElementById('btn-close-detail');
  if (btnCloseDetail) {
    btnCloseDetail.addEventListener('click', closeDetailCard);
  }

  // 第四階段：白話說明卡片切換按鈕（循環切換）
  const btnExplainPrev = document.getElementById('btn-explain-prev');
  const btnExplainNext = document.getElementById('btn-explain-next');
  if (btnExplainPrev && btnExplainNext) {
    btnExplainPrev.addEventListener('click', () => {
      currentExplainIndex = (currentExplainIndex - 1 + explainCardsData.length) % explainCardsData.length;
      renderExplainCard();
    });
    btnExplainNext.addEventListener('click', () => {
      currentExplainIndex = (currentExplainIndex + 1) % explainCardsData.length;
      renderExplainCard();
    });
    renderExplainCard();
  }

  // 共同範圍切換開關
  const toggleCommon = document.getElementById('toggle-common-range');
  toggleCommon.addEventListener('change', (e) => {
    commonRangeOnly = e.target.checked;
    applyFilters();
  });

  // 海岸線顯示開關
  const toggleCoast = document.getElementById('toggle-coastline');
  toggleCoast.addEventListener('change', (e) => {
    if (coastlineMesh) {
      coastlineMesh.visible = e.target.checked;
    }
  });

  // 範圍框線與網格開關
  const toggleBox = document.getElementById('toggle-box');
  toggleBox.addEventListener('change', (e) => {
    if (boundsMesh) {
      boundsMesh.visible = e.target.checked;
    }
  });

  // 3D 地形模型開關
  const toggleTerrain = document.getElementById('toggle-terrain');
  if (toggleTerrain) {
    toggleTerrain.addEventListener('change', (e) => {
      if (terrainGroup) {
        terrainGroup.visible = e.target.checked;
      }
      if (terrainGuideLines) {
        terrainGuideLines.visible = e.target.checked && terrainGroup.position.y > 0.5;
      }
    });
  }

  // 掀開地表滑桿
  const sliderLift = document.getElementById('slider-lift');
  if (sliderLift) {
    sliderLift.addEventListener('input', (e) => {
      updateTerrainLift(parseFloat(e.target.value));
    });
  }

  // 地表不透明度滑桿
  const sliderOpacity = document.getElementById('slider-opacity');
  if (sliderOpacity) {
    sliderOpacity.addEventListener('input', (e) => {
      updateTerrainOpacity(parseFloat(e.target.value));
    });
  }

  // 右側控制面板收起與展開
  const controlsPanel = document.getElementById('controls-panel');
  const btnCollapseControls = document.getElementById('btn-collapse-controls');
  const btnExpandControls = document.getElementById('btn-expand-controls');

  if (btnCollapseControls && controlsPanel && btnExpandControls) {
    btnCollapseControls.addEventListener('click', () => {
      controlsPanel.classList.add('collapsed');
      btnExpandControls.style.display = 'flex';
    });
    btnExpandControls.addEventListener('click', () => {
      controlsPanel.classList.remove('collapsed');
      btnExpandControls.style.display = 'none';
    });
  }

  // 左側圖例與說明收起與展開
  const leftPanels = document.getElementById('left-panels-container');
  const btnCollapseLeft = document.getElementById('btn-collapse-left');
  const btnExpandLeft = document.getElementById('btn-expand-left');

  if (btnCollapseLeft && leftPanels && btnExpandLeft) {
    btnCollapseLeft.addEventListener('click', () => {
      leftPanels.classList.add('collapsed');
      btnExpandLeft.style.display = 'flex';
    });
    btnExpandLeft.addEventListener('click', () => {
      leftPanels.classList.remove('collapsed');
      btnExpandLeft.style.display = 'none';
    });
  }

  // 手機：開場先收起面板讓出 3D 畫面，且同時只開一個面板
  if (window.matchMedia('(max-width: 768px), (max-height: 500px)').matches) {
    btnCollapseControls.click();
    btnCollapseLeft.click();
    btnExpandControls.addEventListener('click', () => btnCollapseLeft.click());
    btnExpandLeft.addEventListener('click', () => btnCollapseControls.click());
  }
}

// ==============================================================================
// 11. 程式啟動
// ==============================================================================

window.addEventListener('DOMContentLoaded', async () => {
  initThree();
  await loadCoastline();
  await loadTerrain();
  await loadEarthquakes();
});
