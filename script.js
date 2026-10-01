/* ============================================================================
 * LOCATION-SHARING SOCIAL DISCONNECTION PARADIGM
 * Condition: CONTROL (G and M approach the user's start point, total ~65s)
 *
 * G ve M, aynı pause/deviation zamanlamasıyla, SABİT yürüme hızında
 * (WALK_SPEED_MPS, ikisi için de eşit) yürüyerek 62 sn sonunda START_U'nun
 * (blue dot başlangıcı) hemen yanında, birbirine değip duran ama birbirini
 * kaplamayan iki noktada son buluyor.
 *
 * Nasıl çalışıyor:
 *  1. REF_SCHEDULE_* eski hareket şablonudur (zamanlama + şekil); şablonun
 *     net yer değiştirme vektörünün BOYU, hız sabit olduğu için sabittir.
 *  2. TARGET_G / TARGET_M, START_U'nun hemen solunda ve sağında (ekranda
 *     yan yana görünecek şekilde, harita dönüşüne göre hesaplanmış), gri
 *     marker'ların tam olarak birbirine dokunduğu (overlap etmeyen) iki
 *     noktadır.
 *  3. Şablon, eski rotanın genel yönünü (REF_START -> TARGET) koruyacak
 *     şekilde döndürülür (ölçeklenmez — hız sabit kalır), sonra
 *     START_G / START_M bu döndürülmüş vektör TARGET'a denk gelecek şekilde
 *     GERİYE doğru hesaplanır (başlangıç noktası hedefe göre ayarlanır).
 *     Böylece deviation'lar yürüme yönüne göre aynı tarafta kalır, pause'lar
 *     birebir korunur ve bitiş noktası matematiksel olarak TARGET'a denk
 *     gelir.
 *
 * ── MOVEMENT TABLE (global seconds, yönler yürüme yönüne göredir) ───────────
 *  t         G                         M
 *  0– 2    pause                     pause
 *  2– 8    straight                  deviate (ref EAST)
 *  8–11    PAUSE (3s)                straight
 * 11–12    straight                  PAUSE (1s)
 * 12–18    deviate (ref EAST)        straight
 * 18–20    straight                  PAUSE (2s)
 * 20–26    straight                  deviate (ref 342°)
 * 26–28    PAUSE (2s)                straight
 * 28–30    straight                  PAUSE (2s)
 * 30–36    deviate (ref WEST)        straight
 * 36–38    straight                  PAUSE (2s)
 * 38–44    straight                  deviate (ref EAST)
 * 44–48    PAUSE (4s)                straight
 * 48–50    straight                  PAUSE (2s)
 * 50–53    deviate (ref EAST)        deviate (ref WEST)
 * 53–56    deviate (ref WEST)        deviate (ref EAST)
 * 56–62    straight                  straight   -> G ve M, START_U'nun iki
 *                                                   yanında birbirine değer
 * ========================================================================== */
const CONDITION         = "CONTROL";
const CONDITION_LABEL = "Control Condition";
const MAP_CENTER         = [32.888799, 39.929662];
const SCENE_ROTATION_DEG = 21;
const MAP_ZOOM           = 17.5;
const WALK_SPEED_MPS = 2.0;   // G ve M için sabit, ortak yürüme hızı
const T_STABLE       = 2000;
const T_FINAL_HOLD   = 3000;

// Grey marker'ın render edilen gerçek çapı (CSS: width 28.35px + border 1.6875px*2,
// content-box varsayılan box-sizing ile border genişliğe eklenir).
const GREY_MARKER_RENDERED_PX = 28.35 + 2 * 1.6875; // = 31.725px
// G ve M birbirine "en fazla değecek" ama kaplamayacak şekilde durması için
// merkezden merkeze mesafe = marker çapı (= yarıçapların toplamı, eşit boyut
// oldukları için) + görünür bir boşluk payı (ikonların kenarları net ayrılsın).
const TOUCH_GAP_PX = GREY_MARKER_RENDERED_PX + 6; // ~37.7px merkez-merkez

// ── Helpers ──────────────────────────────────────────────────────────────────
function calculateBearing(start, end) {
    const r = d => d * Math.PI / 180;
    const dLng = r(end[0] - start[0]);
    const y = Math.sin(dLng) * Math.cos(r(end[1]));
    const x = Math.cos(r(start[1])) * Math.sin(r(end[1]))
            - Math.sin(r(start[1])) * Math.cos(r(end[1])) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const EARTH_RADIUS_M = 6378137;
const M_PER_DEG_LAT  = Math.PI * EARTH_RADIUS_M / 180;

function offsetMeters(origin, bearingDeg, meters) {
    const b = bearingDeg * Math.PI / 180;
    const dLat = (meters * Math.cos(b) / EARTH_RADIUS_M) * 180 / Math.PI;
    const dLng = (meters * Math.sin(b) /
        (EARTH_RADIUS_M * Math.cos(origin[1] * Math.PI / 180))) * 180 / Math.PI;
    return [origin[0] + dLng, origin[1] + dLat];
}

// Local flat metric frame (x = east m, y = north m) around a reference point
function toXY(p, ref) {
    const k = Math.cos(ref[1] * Math.PI / 180);
    return [(p[0] - ref[0]) * M_PER_DEG_LAT * k, (p[1] - ref[1]) * M_PER_DEG_LAT];
}
function fromXY(xy, ref) {
    const k = Math.cos(ref[1] * Math.PI / 180);
    return [ref[0] + xy[0] / (M_PER_DEG_LAT * k), ref[1] + xy[1] / M_PER_DEG_LAT];
}
function vecBearing(v) { return (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360; }

// Haritanın ekran-piksel/metre oranı (Web Mercator), MAP_ZOOM ve enlem için.
function metersPerPixel(lat, zoom) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function buildPureDrift(totalDur, driftBearing) {
    return [{ d: totalDur, b: driftBearing }];
}

const EAST = 90;
const WEST = 270;

// ── Locations ─────────────────────────────────────────────────────────────────
// Original starting points: only used to reconstruct the old routes' end points
const REF_START_G  = [32.888409, 39.929681];
const REF_START_M  = [32.889090, 39.929422];
const REF_TARGET_G = [32.888455, 39.930278];
const REF_TARGET_M = [32.890168, 39.929707];
const START_U = [32.888559, 39.929150];
const ROAD_START    = [32.888752, 39.929566];
const ROAD_TARGET_1 = [32.888541, 39.930241];
const ROAD_TARGET_2 = [32.889835, 39.929885];
const BG = calculateBearing(REF_START_G, REF_TARGET_G);
const BM = calculateBearing(REF_START_M, REF_TARGET_M);

// ── Reference schedules (original timing & shape, unchanged) ────────────────
const REF_SCHEDULE_G = [
    { d: 2,  b: null },                    // global  0– 2  pause
    { d: 6,  b: BG },                      // global  2– 8  straight
    { d: 3,  b: null },                    // global  8–11  PAUSE (3s)
    { d: 1,  b: BG },                      // global 11–12  straight
    ...buildPureDrift(6, EAST),            // global 12–18  deviate
    { d: 2,  b: BG },                      // global 18–20  straight
    { d: 6,  b: BG },                      // global 20–26  straight
    { d: 2,  b: null },                    // global 26–28  PAUSE (2s)
    { d: 2,  b: BG },                      // global 28–30  straight
    ...buildPureDrift(6, WEST),            // global 30–36  deviate
    { d: 2,  b: BG },                      // global 36–38  straight
    { d: 6,  b: BG },                      // global 38–44  straight
    { d: 4,  b: null },                    // global 44–48  PAUSE (4s)
    { d: 2,  b: BG },                      // global 48–50  straight
    ...buildPureDrift(3, EAST),            // global 50–53  deviate
    ...buildPureDrift(3, WEST),            // global 53–56  deviate
    { d: 6,  b: BG },                      // global 56–62  straight
];

const REF_SCHEDULE_M = [
    { d: 2,  b: null },                    // global  0– 2  pause
    ...buildPureDrift(6, EAST),            // global  2– 8  deviate
    { d: 3,  b: BM },                      // global  8–11  straight
    { d: 1,  b: null },                    // global 11–12  PAUSE (1s)
    { d: 6,  b: BM },                      // global 12–18  straight
    { d: 2,  b: null },                    // global 18–20  PAUSE (2s)
    ...buildPureDrift(6, 342),             // global 20–26  deviate (BM-90°)
    { d: 2,  b: BM },                      // global 26–28  straight
    { d: 2,  b: null },                    // global 28–30  PAUSE (2s)
    { d: 6,  b: BM },                      // global 30–36  straight
    { d: 2,  b: null },                    // global 36–38  PAUSE (2s)
    ...buildPureDrift(6, EAST),            // global 38–44  deviate
    { d: 4,  b: BM },                      // global 44–48  straight
    { d: 2,  b: null },                    // global 48–50  PAUSE (2s)
    ...buildPureDrift(3, WEST),            // global 50–53  deviate
    ...buildPureDrift(3, EAST),            // global 53–56  deviate
    { d: 6,  b: BM },                      // global 56–62  straight
];

// ── Old route end points: sadece yaklaşma yönünü belirlemek için referans ────
function refEndPoint(startPos, segments) {
    let pos = startPos;
    for (const seg of segments)
        if (seg.b !== null) pos = offsetMeters(pos, seg.b, WALK_SPEED_MPS * seg.d);
    return pos;
}
const OLD_ROUTE_END_G = refEndPoint(REF_START_G, REF_SCHEDULE_G);
const OLD_ROUTE_END_M = refEndPoint(REF_START_M, REF_SCHEDULE_M);

// ── Final targets: START_U'nun iki yanında, grey marker'lar birbirine
// değecek (TOUCH_GAP_PX) ama kaplamayacak şekilde, ekranda yan yana ─────────
const MPP = metersPerPixel(START_U[1], MAP_ZOOM);
const TOUCH_GAP_M = TOUCH_GAP_PX * MPP;
const HALF_GAP_M  = TOUCH_GAP_M / 2;
// Harita SCENE_ROTATION_DEG kadar döndürülmüş durumda: ekranın "sağı" coğrafi
// olarak (SCENE_ROTATION_DEG + 90°) yönüne, "solu" ise +270° yönüne denk gelir.
const SCREEN_RIGHT_BEARING = (SCENE_ROTATION_DEG + 90) % 360;
const SCREEN_LEFT_BEARING  = (SCENE_ROTATION_DEG + 270) % 360;
const TARGET_G = offsetMeters(START_U, SCREEN_LEFT_BEARING,  HALF_GAP_M); // leftNode
const TARGET_M = offsetMeters(START_U, SCREEN_RIGHT_BEARING, HALF_GAP_M); // rightNode

// ── Approach schedules: şablon döndürülür (yön eski rotayla aynı kalır),
// hız SABİT (WALK_SPEED_MPS) tutulur; başlangıç noktası, döndürülmüş
// şablon tam olarak TARGET'a denk gelecek şekilde GERİYE hesaplanır.
function buildApproachSchedule(refSchedule, oldRouteEnd, targetPos) {
    // net displacement of the template at the fixed walking speed (meters)
    let L = [0, 0];
    for (const s of refSchedule) {
        if (s.b === null) continue;
        const r = s.b * Math.PI / 180, m = WALK_SPEED_MPS * s.d;
        L = [L[0] + m * Math.sin(r), L[1] + m * Math.cos(r)];
    }
    // Yön: eski rotanın bitişinden hedefe olan yön (büyüklüğü değil, sadece
    // açısı kullanılır) — "tersten" yaklaşma hissi böyle korunur.
    const oldEndXY = toXY(oldRouteEnd, targetPos);
    const D = [-oldEndXY[0], -oldEndXY[1]];            // oldRouteEnd -> target yönü
    const rot = (vecBearing(D) - vecBearing(L) + 360) % 360;

    // Şablon vektörü rot kadar döndürülür (büyüklüğü sabit kalır, ölçeklenmez).
    const Lmag = Math.hypot(L[0], L[1]);
    const Lbearing = vecBearing(L);
    const fRad = (Lbearing + rot) * Math.PI / 180;
    const F = [Lmag * Math.sin(fRad), Lmag * Math.cos(fRad)];

    // START = TARGET - F  (metrik çerçeve TARGET merkezli; TARGET_xy = [0,0])
    const startPos = fromXY([-F[0], -F[1]], targetPos);

    return {
        startPos,
        rotationDeg: rot,
        speed: WALK_SPEED_MPS,
        segments: refSchedule.map(s => s.b === null
            ? { d: s.d, b: null }
            : { d: s.d, b: (s.b + rot + 360) % 360 })
    };
}

const APPROACH_G = buildApproachSchedule(REF_SCHEDULE_G, OLD_ROUTE_END_G, TARGET_G);
const APPROACH_M = buildApproachSchedule(REF_SCHEDULE_M, OLD_ROUTE_END_M, TARGET_M);
const START_G = APPROACH_G.startPos;
const START_M = APPROACH_M.startPos;
const SCHEDULE_G = APPROACH_G.segments;
const SCHEDULE_M = APPROACH_M.segments;

// ── Runtime ───────────────────────────────────────────────────────────────────
function scheduleTotalSeconds(s) { return s.reduce((a, seg) => a + seg.d, 0); }
const ACTIVE_MS_G = scheduleTotalSeconds(SCHEDULE_G) * 1000;
const ACTIVE_MS_M = scheduleTotalSeconds(SCHEDULE_M) * 1000;
const TOTAL_ANIMATION_DURATION = T_STABLE + Math.max(ACTIVE_MS_G, ACTIVE_MS_M) + T_FINAL_HOLD;

let userPos = [...START_U];
let moveInterval = null;
let currentDirectionBtn = null;

const positions = { leftNode: START_G, rightNode: START_M, mainNode: userPos };
const people = [
    { id: "leftNode",  markerType: "grey-letter-dot", initial: "G" },
    { id: "rightNode", markerType: "grey-letter-dot", initial: "M" },
    { id: "mainNode",  markerType: "blue-pulse-dot"  }
];

// Waypoints built in a flat metric frame centered on the target, so the last
// waypoint lands exactly on the target.
function buildWaypoints(startPos, segments, speed, ref) {
    let xy = toXY(startPos, ref), t = 0;
    const keys = [{ t: 0, pos: startPos }];
    for (const seg of segments) {
        t += seg.d * 1000;
        if (seg.b !== null) {
            const r = seg.b * Math.PI / 180, m = speed * seg.d;
            xy = [xy[0] + m * Math.sin(r), xy[1] + m * Math.cos(r)];
        }
        keys.push({ t, pos: fromXY(xy, ref) });
    }
    return keys;
}

function positionAt(keys, tMs) {
    if (tMs <= 0) return keys[0].pos;
    for (let i = 1; i < keys.length; i++) {
        if (tMs <= keys[i].t) {
            const a = keys[i - 1], b = keys[i];
            const f = (tMs - a.t) / (b.t - a.t);
            return [
                a.pos[0] + (b.pos[0] - a.pos[0]) * f,
                a.pos[1] + (b.pos[1] - a.pos[1]) * f
            ];
        }
    }
    return keys[keys.length - 1].pos;
}

const WAYPOINTS_G = buildWaypoints(START_G, SCHEDULE_G, WALK_SPEED_MPS, TARGET_G);
const WAYPOINTS_M = buildWaypoints(START_M, SCHEDULE_M, WALK_SPEED_MPS, TARGET_M);

function agentPosition(who, elapsedMs) {
    const keys    = (who === "G") ? WAYPOINTS_G : WAYPOINTS_M;
    const localMs = elapsedMs - T_STABLE;
    if (localMs < 0) return keys[0].pos;
    return positionAt(keys, localMs);
}

let animationStarted = false;
let userNickname     = "";
let map              = null;
const markerInstances = {};
let startTime        = null;

function createMarkerElement(person) {
    const wrap = document.createElement("div"); wrap.className = "marker-cluster";
    const node = document.createElement("div"); node.className = "agent-node";
    if (person.markerType === "blue-pulse-dot") {
        const c = document.createElement("div"); c.className = "google-maps-dot-container";
        const p = document.createElement("div"); p.className = "google-maps-pulse";
        const s = document.createElement("div"); s.className = "google-maps-core";
        c.appendChild(p); c.appendChild(s); node.appendChild(c);
        const lbl = document.createElement("div"); lbl.className = "agent-label";
        lbl.textContent = userNickname || "User"; node.appendChild(lbl);
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", (userNickname || "User") + " location on map");
    } else {
        const dot = document.createElement("div");
        dot.className = "experimental-grey-letter-dot";
        dot.textContent = person.initial; node.appendChild(dot);
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", "Participant " + person.initial + " location on map");
    }
    wrap.appendChild(node); return wrap;
}

function initMarkers() {
    if (!map) return;
    people.forEach(p => {
        const marker = new maplibregl.Marker({ element: createMarkerElement(p), anchor: "center" })
            .setLngLat(positions[p.id]).addTo(map);
        markerInstances[p.id] = marker;
    });
}

function animateNodes(ts) {
    if (!animationStarted) return;
    if (!startTime) startTime = ts;
    const el = ts - startTime;
    if (markerInstances["leftNode"])  markerInstances["leftNode"].setLngLat(agentPosition("G", el));
    if (markerInstances["rightNode"]) markerInstances["rightNode"].setLngLat(agentPosition("M", el));
    if (el < TOTAL_ANIMATION_DURATION) requestAnimationFrame(animateNodes);
    else sendCompletionSignal("normal");
}

const SESSION_ID = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
let hasSentCompletion = false;

function buildPayload(reason) {
    return {
        type: "MAP_ANIMATION_COMPLETE", condition: CONDITION,
        conditionLabel: CONDITION_LABEL, sessionId: SESSION_ID,
        status: "complete", reason, elapsedMs: TOTAL_ANIMATION_DURATION, timestamp: Date.now()
    };
}

function sendCompletionSignal(reason) {
    if (hasSentCompletion) return; hasSentCompletion = true;
    try { if (window.parent) window.parent.postMessage(buildPayload(reason), "*"); }
    catch(e) { console.warn("postMessage failed:", e); }
}

const GLOBAL_TIMEOUT_MS    = 240 * 1000;
const ANIMATION_TIMEOUT_MS = TOTAL_ANIMATION_DURATION + 15000;

function injectUIDesignStyles() {
    if (document.getElementById("study-ui-styles")) return;
    const style = document.createElement("style"); style.id = "study-ui-styles";
    style.innerHTML = `
        :root { --brand-green: rgba(220,242,224,.95) }
        body, html { margin:0; padding:0; width:100%; height:100%; overflow:hidden;
            font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;
            background-color:#f2efe6 }
        #experiment-flow-screen { position:fixed; top:0; left:0; width:100%; height:100%;
            background:#fff; display:flex; align-items:center; justify-content:center;
            z-index:3000; transition:opacity .5s ease,transform .5s ease }
        .flow-step { display:flex; flex-direction:column; align-items:center; gap:20px;
            text-align:center; padding:0 20px }
        .flow-step.hidden { display:none !important }
        .spinner { width:60px; height:60px; border:4px solid rgba(43,108,176,.15);
            border-top:4px solid #2b6cb0; border-radius:50%; animation:spin .8s linear infinite }
        @keyframes spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
        .modern-success-badge { width:56px; height:56px; background:#e6f4ea; border-radius:50%;
            display:flex; align-items:center; justify-content:center; margin:0 auto;
            box-shadow:0 4px 12px rgba(46,125,50,.12) }
        .modern-success-badge svg { width:28px; height:28px; color:#137333; stroke-width:3.8 }
        .flow-text { font-size:16px; font-weight:600; color:#1a1a1a; letter-spacing:-.3px; margin:0 }
        #modern-app-header { position:absolute; top:0; left:0; width:100%; height:64px;
            background:#fff; backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
            border-bottom:1px solid rgba(0,0,0,.06); display:flex; align-items:center;
            justify-content:center; z-index:2000; box-shadow:0 4px 24px rgba(0,0,0,.08) }
        .header-logo { display:flex; align-items:center; gap:10px; font-size:19px; font-weight:700;
            letter-spacing:-.4px; color:#1a1a1a }
        .logo-icon-wrapper { width:34px; height:34px; background:#f0f4f8; border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            box-shadow:inset 0 1px 2px rgba(0,0,0,.06),0 2px 4px rgba(0,0,0,.04) }
        .logo-icon-wrapper svg { color:#2b6cb0 }
        #container { width:100%; height:100%; position:relative }
        #map { width:100%; height:100% }
        .experimental-grey-letter-dot { width:28.35px; height:28.35px; background:#64748b;
            color:#fff; border:1.6875px solid #fff; border-radius:50%; display:flex;
            align-items:center; justify-content:center; font-weight:700; font-size:12.75px;
            box-shadow:0 2.25px 6px rgba(0,0,0,.3) }
        .google-maps-dot-container { position:relative; width:36px; height:36px;
            display:flex; align-items:center; justify-content:center }
        .google-maps-pulse { position:absolute; width:36px; height:36px;
            background:rgba(66,133,244,.4); border-radius:50%;
            animation:google-pulse 2s infinite ease-out }
        .google-maps-core { position:relative; width:15.75px; height:15.75px; background:#4285F4;
            border:2.25px solid #fff; border-radius:50%; box-shadow:0 2.25px 6px rgba(0,0,0,.35) }
        @keyframes google-pulse { 0%{transform:scale(.6);opacity:1} 100%{transform:scale(2.2);opacity:0} }
        .agent-label { position:absolute; bottom:-21px; background:rgba(255,255,255,.95);
            padding:2px 7px; border-radius:5px; font-size:11px; font-weight:600; color:#1a1a1a;
            box-shadow:0 1px 5px rgba(0,0,0,.15); white-space:nowrap }
        .login-container { display:flex; flex-direction:column; align-items:center; gap:16px; width:300px }
        .instruction { font-size:15px; color:#374151; text-align:center; margin:0; line-height:1.5 }
        #nickname-input { width:100%; padding:12px 16px; border:1px solid #cbd5e1; border-radius:12px;
            font-size:16px; outline:none; transition:border-color .2s; text-align:center; box-sizing:border-box }
        #nickname-input:focus { border-color:#2b6cb0; box-shadow:0 0 0 3px rgba(43,108,176,.15) }
        .input-note { font-size:13px; color:#6b7280; text-align:center; margin:0; line-height:1.4 }
        #submit-btn { width:48px; height:48px; background:#2b6cb0; color:#fff; border:none;
            border-radius:50%; font-size:20px; cursor:pointer; display:flex; align-items:center;
            justify-content:center; transition:background .2s,transform .1s }
        #submit-btn:active { transform:scale(.96); background:#2c5282 }
        
        /* ── D-Pad / Kumanda Tasarımı (Interactive kottan alındı) ── */
        #d-pad {
            position: absolute;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%);
            width: 104px;
            height: 104px;
            background: var(--brand-green);
            border-radius: 50%;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06);
            border: 2px solid rgba(255, 255, 255, 0.9);
            z-index: 2500;
            cursor: pointer;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            transition: transform 0.1s ease, box-shadow 0.1s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #d-pad:active, #d-pad.active {
            transform: translateX(-50%) scale(0.95);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            background: #c8e6cb;
        }
        .pad-indicator {
            position: absolute;
            color: rgba(45, 55, 72, 0.65);
            pointer-events: none;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease;
        }
        #d-pad:active .pad-indicator, #d-pad.active .pad-indicator {
            color: rgba(26, 32, 44, 0.9);
        }
        .ind-n  { top: 5px; left: 50%; transform: translateX(-50%); font-size: 12px; }
        .ind-ne { top: 16px; right: 16px; font-size: 8px; }
        .ind-e  { right: 6px; top: 50%; transform: translateY(-50%); font-size: 12px; }
        .ind-se { bottom: 16px; right: 16px; font-size: 8px; }
        .ind-s  { bottom: 5px; left: 50%; transform: translateX(-50%); font-size: 12px; }
        .ind-sw { bottom: 16px; left: 16px; font-size: 8px; }
        .ind-w  { left: 6px; top: 50%; transform: translateY(-50%); font-size: 12px; }
        .ind-nw { top: 16px; left: 16px; font-size: 8px; }
    `;
    document.head.appendChild(style);
}

function bootstrap() {
    injectUIDesignStyles();
    setTimeout(() => { if (!hasSentCompletion) sendCompletionSignal("timeout"); }, GLOBAL_TIMEOUT_MS);

    const flowScreen     = document.getElementById("experiment-flow-screen");
    const stepConnecting = document.getElementById("step-connecting");
    const stepWaiting    = document.getElementById("step-waiting");
    const stepJoined     = document.getElementById("step-joined");
    const stepNickname   = document.getElementById("step-nickname");
    const nicknameInput  = document.getElementById("nickname-input");
    const submitBtn      = document.getElementById("submit-btn");

    if (stepJoined && !stepJoined.querySelector(".modern-success-badge")) {
        const b = document.createElement("div"); b.className = "modern-success-badge";
        b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        stepJoined.insertBefore(b, stepJoined.firstChild);
    }

    function startExperimentFlow() {
        setTimeout(() => {
            if (stepConnecting) stepConnecting.classList.add("hidden");
            if (stepWaiting)    stepWaiting.classList.remove("hidden");
            setTimeout(() => {
                if (stepWaiting) stepWaiting.classList.add("hidden");
                if (stepJoined)  stepJoined.classList.remove("hidden");
                setTimeout(() => {
                    if (stepJoined)    stepJoined.classList.add("hidden");
                    if (stepNickname)  stepNickname.classList.remove("hidden");
                    if (nicknameInput) nicknameInput.focus();
                }, 4000);
            }, 5000);
        }, 3000);
    }

    function beginAnimation() {
        animationStarted = true;
        const hdr = document.createElement("div"); hdr.id = "modern-app-header";
        hdr.innerHTML = `<div class="header-logo"><div class="logo-icon-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
            </svg></div>DoveSeiApp</div>`;
        document.body.appendChild(hdr);

        if (!document.getElementById("d-pad")) {
            const dpad = document.createElement('div');
            dpad.id = 'd-pad';
            dpad.setAttribute('aria-label', "Area di controllo del movimento");
            dpad.innerHTML = `
                <span class="pad-indicator ind-n">&#9650;</span>
                <span class="pad-indicator ind-ne">&bull;</span>
                <span class="pad-indicator ind-e">&#9654;</span>
                <span class="pad-indicator ind-se">&bull;</span>
                <span class="pad-indicator ind-s">&#9660;</span>
                <span class="pad-indicator ind-sw">&bull;</span>
                <span class="pad-indicator ind-w">&#9664;</span>
                <span class="pad-indicator ind-nw">&bull;</span>
            `;
            document.body.appendChild(dpad);
        }

        setTimeout(() => { if (!hasSentCompletion) sendCompletionSignal("timeout"); }, ANIMATION_TIMEOUT_MS);
        requestAnimationFrame(animateNodes);
        setupMovementControls();
    }

    function handleLoginSubmit() {
        const val = nicknameInput ? nicknameInput.value.trim() : "Participant";
        if (!val) { alert("Inserisci un nickname valido."); return; }
        userNickname = val;
        if (flowScreen) { flowScreen.style.opacity = "0"; flowScreen.style.transform = "scale(0.95)"; }
        setTimeout(() => {
            if (flowScreen) flowScreen.style.display = "none";
            initMarkers(); beginAnimation();
        }, 500);
    }

    if (submitBtn) {
        submitBtn.addEventListener("click", handleLoginSubmit);
        submitBtn.setAttribute("aria-label", "Submit nickname and continue");
    }
    if (nicknameInput) {
        nicknameInput.setAttribute("aria-label", "Enter your nickname");
        nicknameInput.addEventListener("keypress", e => { if (e.key === "Enter") handleLoginSubmit(); });
    }

    let mapHasLoaded = false, mapLoadTimeoutId = null;

    function showMapLoadFallback() {
        if (mapHasLoaded) return;
        const mc = document.getElementById("map"); if (mc) mc.style.visibility = "hidden";
        const fb = document.createElement("div"); fb.id = "map-load-fallback";
        fb.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;display:flex;" +
            "align-items:center;justify-content:center;background:#f7f7f7;font-family:sans-serif;" +
            "text-align:center;padding:24px;box-sizing:border-box;z-index:5000;";
        fb.innerHTML = '<div style="max-width:420px;">' +
            '<p style="font-size:17px;color:#333;margin-bottom:8px;">La mappa non è al momento disponibile.</p>' +
            '<p style="font-size:14px;color:#666;">Verifica della connessione in corso, attendere prego.</p></div>';
        document.body.appendChild(fb);
        if (!animationStarted) {
            animationStarted = true;
            setTimeout(() => sendCompletionSignal("map-load-failed"), TOTAL_ANIMATION_DURATION);
        }
    }

    const HIDDEN_SOURCE_LAYERS = ["poi", "housenumber", "mountain_peak", "aerodrome_label", "aeroway"];
    const KEEP_VISIBLE = /park|garden|playground|pitch|forest|wood|water_name|nature|recreation/;

    function declutterBasemap() {
        try {
            (map.getStyle().layers || []).forEach(l => {
                const id  = String(l.id || "").toLowerCase();
                const sl  = String(l["source-layer"] || "").toLowerCase();
                const isExt = l.type === "fill-extrusion";
                if (KEEP_VISIBLE.test(id) || sl === "park") { if (!isExt) return; }
                if (isExt || HIDDEN_SOURCE_LAYERS.includes(sl))
                    try { map.setLayoutProperty(l.id, "visibility", "none"); } catch(e) {}
            });
        } catch(e) {}
    }

    const PAL = {
        land:"#f2efe6", green:"#bfe3ab", greenSoft:"#d6ead0", greenDeep:"#a8d493",
        water:"#a9d8f0", road:"#ffffff", roadCase:"#e4dfd3", building:"#e8e3d8",
        text:"#5a6b5e", textHalo:"#ffffff"
    };
    function paint(id, p, v) { try { map.setPaintProperty(id, p, v); } catch(e) {} }

    function applyFindMyPalette() {
        try {
            (map.getStyle().layers || []).forEach(l => {
                const id = String(l.id || "").toLowerCase();
                const sl = String(l["source-layer"] || "").toLowerCase();
                const t  = l.type;
                const isG = sl === "park" || /park|grass|wood|forest|garden|pitch|golf|cemetery|scrub|meadow|orchard/.test(id);
                const isW = sl === "water" || sl === "waterway" || /water|ocean|river|lake|sea|bay/.test(id);
                if (t === "background") { paint(id, "background-color", PAL.land); return; }
                if (isW) { if (t==="fill") paint(id,"fill-color",PAL.water); if (t==="line") paint(id,"line-color",PAL.water); return; }
                if (isG) { if (t==="fill") { paint(id,"fill-color",PAL.green); paint(id,"fill-opacity",1); } if (t==="line") paint(id,"line-color",PAL.greenDeep); return; }
                if (sl==="landcover") { if (t==="fill") { paint(id,"fill-color",PAL.greenSoft); paint(id,"fill-opacity",.9); } return; }
                if (sl==="landuse")   { if (t==="fill") paint(id,"fill-color",PAL.land); return; }
                if (sl==="building")  { if (t === "fill") { paint(id,"fill-color",PAL.building); paint(id,"fill-opacity",.85); } return; }
                if (sl==="transportation") { if (t==="line") paint(id,"line-color",/casing|outline|bridge|tunnel/.test(id)?PAL.roadCase:PAL.road); return; }
                if (t==="symbol") { paint(id,"text-color",PAL.text); paint(id,"text-halo-color",PAL.textHalo); paint(id,"text-halo-width",1.4); }
            });
        } catch(e) {}
    }

    startExperimentFlow();

    try {
        if (typeof maplibregl !== "undefined") {
            map = new maplibregl.Map({
                container: "map",
                style: "https://tiles.openfreemap.org/styles/liberty",
                center: MAP_CENTER,
                zoom: MAP_ZOOM,
                minZoom: MAP_ZOOM,
                maxZoom: MAP_ZOOM,
                bearing: SCENE_ROTATION_DEG,
                dragPan: false, doubleClickZoom: false, boxZoom: false,
                keyboard: false, touchZoomRotate: false,
                pixelRatio: window.devicePixelRatio || 2,
                attributionControl: true
            });

            mapLoadTimeoutId = setTimeout(() => { if (!mapHasLoaded) showMapLoadFallback(); }, 8000);

            map.on("load", () => {
                mapHasLoaded = true; clearTimeout(mapLoadTimeoutId);
                declutterBasemap(); applyFindMyPalette();

                map.addSource("virtual-roads", { type: "geojson", data: { type: "FeatureCollection", features: [
                    { type: "Feature", geometry: { type: "LineString", coordinates: [
                        [32.888409, 39.929681],
                        [32.887900, 39.931650],
                        [32.887550, 39.933000]
                    ] } },
                    { type: "Feature", geometry: { type: "LineString", coordinates: [
                        [32.889090, 39.929422],
                        [32.890168, 39.929707],
                        [32.891200, 39.930400],
                        [32.892400, 39.931400]
                    ] } },
                    { type: "Feature", geometry: { type: "LineString", coordinates: [ROAD_START, ROAD_TARGET_1] } },
                    { type: "Feature", geometry: { type: "LineString", coordinates: [ROAD_START, ROAD_TARGET_2] } },
                    { type: "Feature", geometry: { type: "LineString", coordinates: [[32.888292,39.930351],[32.887327,39.930721]] } }
                ]}});

                let firstRoadLayerId = null;
                for (const l of map.getStyle().layers) {
                    const sl = (l["source-layer"] || "").toLowerCase();
                    if (sl === "transportation") {
                        firstRoadLayerId = l.id;
                        break;
                    }
                }

                map.addLayer({
                    id: "virtual-roads-casing", type: "line", source: "virtual-roads",
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: { "line-color": "#e4dfd3", "line-width": 12 }
                }, firstRoadLayerId);

                map.addLayer({
                    id: "virtual-roads-core", type: "line", source: "virtual-roads",
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: { "line-color": "#ffffff", "line-width": 8 }
                }, firstRoadLayerId);

                map.getCanvas().style.filter = "none";
            });

            map.on("error", () => { if (!mapHasLoaded) showMapLoadFallback(); });
        }
    } catch(e) { showMapLoadFallback(); }
}

function setupMovementControls() {
    const TICK_RATE_MS = 30; 
    const METERS_PER_TICK = (WALK_SPEED_MPS / 1000) * TICK_RATE_MS;

    const keyDirections = {
        'ArrowUp': (0 + SCENE_ROTATION_DEG) % 360, 
        'ArrowRight': (90 + SCENE_ROTATION_DEG) % 360, 
        'ArrowDown': (180 + SCENE_ROTATION_DEG) % 360, 
        'ArrowLeft': (270 + SCENE_ROTATION_DEG) % 360
    };

    const moveStep = (bearing) => {
        userPos = offsetMeters(userPos, bearing, METERS_PER_TICK);
        positions["mainNode"] = userPos;
        
        if (markerInstances["mainNode"]) {
            markerInstances["mainNode"].setLngLat(userPos);
        }
        if (map) {
            map.easeTo({ center: userPos, duration: TICK_RATE_MS, easing: (t) => t });
        }
    };

    const startMove = (bearing, identifier) => {
        if (moveInterval) clearInterval(moveInterval);
        currentDirectionBtn = identifier;
        
        const touchpad = document.getElementById('d-pad');
        if (touchpad) touchpad.classList.add('active');

        moveStep(bearing);
        moveInterval = setInterval(() => moveStep(bearing), TICK_RATE_MS);
    };

    const stopMove = (identifier) => {
        if (currentDirectionBtn !== identifier && identifier !== 'ALL') return;
        
        if (moveInterval) {
            clearInterval(moveInterval);
            moveInterval = null;
            currentDirectionBtn = null;
        }
        const touchpad = document.getElementById('d-pad');
        if (touchpad) touchpad.classList.remove('active');
    };

    const handleTouchpadInteraction = (clientX, clientY, identifier) => {
        const touchpad = document.getElementById('d-pad');
        if (!touchpad) return;
        const rect = touchpad.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dx = clientX - centerX;
        const dy = clientY - centerY; 

        let angleDeg = Math.atan2(dx, -dy) * (180 / Math.PI);
        if (angleDeg < 0) angleDeg += 360;

        const bearing = (angleDeg + SCENE_ROTATION_DEG) % 360;
        startMove(bearing, identifier);
    };

    const touchpad = document.getElementById('d-pad');
    if (touchpad) {
        touchpad.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleTouchpadInteraction(e.clientX, e.clientY, 'mouse');
        });

        touchpad.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            handleTouchpadInteraction(touch.clientX, touch.clientY, 'touch');
        }, { passive: false });

        window.addEventListener('mouseup', () => stopMove('mouse'));
        touchpad.addEventListener('mouseleave', () => stopMove('mouse'));
        window.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) stopMove('touch');
        });
    }

    window.addEventListener('keydown', (e) => {
        if (keyDirections[e.key] !== undefined && currentDirectionBtn !== e.key) {
            startMove(keyDirections[e.key], e.key);
        }
    });
    window.addEventListener('keyup', (e) => {
        if (keyDirections[e.key] !== undefined) {
            stopMove(e.key);
        }
    });
}

if (typeof window !== "undefined" && typeof document !== "undefined") bootstrap();

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        CONDITION, CONDITION_LABEL, SCHEDULE_G, SCHEDULE_M,
        REF_SCHEDULE_G, REF_SCHEDULE_M, APPROACH_G, APPROACH_M,
        OLD_ROUTE_END_G, OLD_ROUTE_END_M,
        START_G, START_M, START_U, TARGET_G, TARGET_M,
        MAP_CENTER, MAP_ZOOM, WALK_SPEED_MPS, SCENE_ROTATION_DEG,
        TOUCH_GAP_M, TOUCH_GAP_PX, MPP,
        T_STABLE, T_FINAL_HOLD, TOTAL_ANIMATION_DURATION,
        agentPosition, offsetMeters, buildPureDrift, calculateBearing,
        metersPerPixel, toXY, fromXY,
        EAST, WEST
    };
}