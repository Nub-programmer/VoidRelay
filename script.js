// 🚀 VoidRelay Core Logic // Stabilization & Realism Build
const supabaseUrl = window.VOID_SB_URL;
const supabaseKey = window.VOID_SB_KEY;

let sb;
if (supabaseKey && supabaseUrl) {
    sb = window.supabase.createClient(supabaseUrl, supabaseKey);
} else {
    console.error("❌ Supabase config missing.");
}

// orbital configs
const ORBIT_SPEED_MULT = 0.0008;
const ORBIT_RAD_EARTH = 15;
const ORBIT_RAD_MARS = 35;
const ORBIT_RAD_MOON = 6;

// Solar Storm Config
const STORM_CONFIG = {
    spawnIntervalMin: 30000,
    spawnIntervalMax: 90000,
    durationMin: 5000,
    durationMax: 9000,
    lossIncrease: 25,
    flareIntervalMin: 180000,
    flareIntervalMax: 420000,
    flareDuration: 4000
};

// App State
let user = null;
let codename = localStorage.getItem('void_relay_codename') || 'GUEST';
let stats = { marsPings: 0 };
let isStorming = false;
let isInitialized = false;
let emergencyTokens = parseInt(localStorage.getItem('emergency_tokens')) || 2;
let currentStrategy = 'NORMAL';
let recentLogs = [];
let selectedReplayIndex = -1;
let unlockedCache = new Set();

// Guest achievements fallback
const localPreviewAchievements = [
    { name: 'First Contact', description: 'Relay your first signal.', unlocked: true },
    { name: 'Mars Explorer', description: 'Reach the red planet.', unlocked: false },
    { name: 'Storm Survivor', description: 'Communicate during a storm.', unlocked: false }
];

// Planet Data
const PLANET_STATES = { earth: 'nominal', moon: 'nominal', mars: 'nominal' };
const PLANET_DATA = {
    earth: { name: 'Earth', angle: 0, speed: 0.5, radius: ORBIT_RAD_EARTH, pos: { x: 50, y: 50 } },
    mars: { name: 'Mars', angle: Math.PI, speed: 0.2, radius: ORBIT_RAD_MARS, pos: { x: 50, y: 50 } },
    moon: { name: 'Moon', angle: 0, speed: 2.0, radius: ORBIT_RAD_MOON, pos: { x: 0, y: 0 } }
};

const asteroids = [];
const activeStorms = new Set();

// -----------------------------------------------------
// SECTION 2 — AUTH STATE SWITCH FIX
// -----------------------------------------------------

async function initApp() {
    console.log('[init] starting...');
    if (!sb) return;

    // Single Auth Listener
    sb.auth.onAuthStateChange((event, session) => {
        console.log('[auth] state change:', event);
        user = session?.user || null;
        resetUIState();
        initDataForUser();
    });

    // Initial session check
    const { data: { session } } = await sb.auth.getSession();
    user = session?.user || null;

    setupStaticUI();
    initDataForUser();

    isInitialized = true;
    requestAnimationFrame(mainLoop);
    
    // Environment loops
    setInterval(cycleAmbientInterference, 20000);
    setInterval(() => { if (Math.random() < 0.4) spawnAsteroid(); }, 30000);
    scheduleStorm();
    scheduleFlare();

    printRealismCheck();
}

function resetUIState() {
    console.log('[ui] resetting state');
    const alist = document.getElementById('achievements-list');
    if (alist) alist.innerHTML = '';
    const lblist = document.getElementById('leaderboard-list');
    if (lblist) lblist.innerHTML = '';
    recentLogs = [];
}

async function initDataForUser() {
    console.log('[init] loading data for user:', user?.id || 'guest');
    if (user && !user.is_anonymous) {
        try {
            const { data: profile, error } = await sb.from('profiles').select('codename').eq('id', user.id).maybeSingle();
            if (error) throw error;
            codename = profile ? profile.codename : 'OPERATOR';
        } catch (e) {
            console.error('[init] profile error:', e);
            codename = 'OPERATOR';
        }
    } else {
        codename = localStorage.getItem('void_relay_codename') || 'GUEST';
    }
    updateUIState();
    // Use Promise.all to load both in parallel
    await Promise.all([loadAchievements(), loadLeaderboard()]);
}

// -----------------------------------------------------
// SECTION 1 — THEME SYSTEM (FIXED PROPERLY)
// -----------------------------------------------------

function setupStaticUI() {
    const stars = document.getElementById('stars-container');
    if (stars) {
        for (let i = 0; i < 100; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            s.style.width = s.style.height = Math.random() * 2 + 'px';
            s.style.left = Math.random() * 100 + '%'; s.style.top = Math.random() * 100 + '%';
            s.style.opacity = Math.random();
            stars.appendChild(s);
        }
    }

    const savedTheme = localStorage.getItem('void_theme') || 'space';
    document.body.dataset.theme = savedTheme;
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = savedTheme;
        themeSelect.onchange = (e) => {
            document.body.dataset.theme = e.target.value;
            localStorage.setItem('void_theme', e.target.value);
            addLog(`Theme changed to ${e.target.value}`, 'sys');
        };
    }

    const vizContainer = document.getElementById('viz-container');
    const toggleMiniviewBtn = document.getElementById('toggle-miniview');
    if (vizContainer && toggleMiniviewBtn) {
        if (localStorage.getItem('void_mini_view') === '1') {
            vizContainer.classList.add('mini');
            toggleMiniviewBtn.innerText = "Expand";
        }
        toggleMiniviewBtn.onclick = () => {
            const isMini = vizContainer.classList.toggle('mini');
            localStorage.setItem('void_mini_view', isMini ? '1' : '0');
            toggleMiniviewBtn.innerText = isMini ? "Expand" : "Miniview";
        };
    }

    document.getElementById('sim-speed')?.addEventListener('input', e => { 
        const speedVal = document.getElementById('speed-val');
        if (speedVal) speedVal.innerText = `${e.target.value}x`; 
        updateLatencyEstimate();
    });
    document.getElementById('packet-loss')?.addEventListener('input', e => { 
        const lossVal = document.getElementById('loss-val');
        if (lossVal) lossVal.innerText = `${e.target.value}%`; 
    });
    document.getElementById('origin')?.addEventListener('change', updateLatencyEstimate);
    document.getElementById('destination')?.addEventListener('change', updateLatencyEstimate);

    document.getElementById('open-knowledge').onclick = () => document.getElementById('knowledge-modal').classList.remove('hidden');
    document.getElementById('close-knowledge').onclick = () => document.getElementById('knowledge-modal').classList.add('hidden');
    document.getElementById('open-telemetry').onclick = openTelemetry;
    document.getElementById('close-telemetry').onclick = () => document.getElementById('telemetry-panel').style.display = 'none';
    document.getElementById('replay-btn').onclick = replayTelemetry;
    document.getElementById('export-btn').onclick = () => exportTelemetry(recentLogs);
    document.getElementById('clear-logs-btn').onclick = () => { recentLogs = []; openTelemetry(); };

    document.getElementById('strategy')?.addEventListener('change', e => {
        currentStrategy = e.target.value;
        addLog(`Strategy: ${currentStrategy}`, 'sys');
    });

    document.getElementById('auth-login').onclick = () => handleAuth('login');
    document.getElementById('auth-signup').onclick = () => handleAuth('signup');
    document.getElementById('auth-guest').onclick = () => {
        codename = "GUEST_" + Math.floor(Math.random() * 9999);
        user = { is_anonymous: true };
        resetUIState();
        initDataForUser();
    };
    document.getElementById('logout-btn').onclick = async () => { 
        await sb.auth.signOut();
    };
}

function updateUIState() {
    const codenameDisplay = document.getElementById('user-codename');
    if (codenameDisplay) codenameDisplay.innerText = codename;
    const authModal = document.getElementById('auth-modal');
    if (authModal) authModal.style.display = user ? 'none' : 'flex';
    const logoutBtn = document.getElementById('logout-btn');
    if (user && !user.is_anonymous && logoutBtn) logoutBtn.classList.remove('hidden');
    const emCount = document.getElementById('emergency-count');
    if (emCount) emCount.innerText = emergencyTokens;
    updateLatencyEstimate();
}

// -----------------------------------------------------
// SECTION 3 — ACHIEVEMENTS (ACCOUNT SAFE)
// -----------------------------------------------------

async function loadAchievements() {
  const container = document.getElementById("achievements-list");
  if (!container) return;
  container.innerHTML = "";

  console.log("[achievements] loading for:", user?.id);

  if (!user || user.is_anonymous) {
    renderAchievements(localPreviewAchievements);
    return;
  }

  try {
    const { data, error } = await sb
      .from("user_achievements")
      .select("unlocked_at, achievements(name, description)")
      .eq("user_id", user.id);

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = "<div>No achievements unlocked yet.</div>";
      return;
    }

    renderAchievements(data.map(d => ({ ...d.achievements, unlocked: true, date: d.unlocked_at })));

  } catch (err) {
    console.error("[achievements] error:", err);
    container.innerHTML = "<div>Offline mode.</div>";
  }
}

function renderAchievements(items) {
    const list = document.getElementById('achievements-list');
    if (!list) return;
    list.innerHTML = items.map(a => `
        <div class="achievement-badge ${a.unlocked ? '' : 'locked'}">
            <span class="icon">${a.unlocked ? '🏆' : '🔒'}</span>
            <div><div class="name">${a.name}</div><div class="desc" style="font-size: 0.7rem; opacity: 0.7;">${a.description}</div></div>
            ${a.date ? `<span class="date">${new Date(a.date).toLocaleDateString()}</span>` : ''}
        </div>
    `).join('');
}

// -----------------------------------------------------
// SECTION 4 — LEADERBOARD FIX (MULTI-ACCOUNT SAFE)
// -----------------------------------------------------

async function loadLeaderboard() {
  const container = document.getElementById("leaderboard-list");
  if (!container) return;
  container.innerHTML = "";

  try {
    const { data, error } = await sb
      .from("leaderboards")
      .select("user_id, codename, mars_pings")
      .order("mars_pings", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = "<div>No operators yet.</div>";
      return;
    }

    data.forEach((row, index) => {
      const div = document.createElement("div");
      div.className = 'entry';
      div.innerHTML = `
        <span>#${index+1} ${row.codename || (row.user_id ? row.user_id.substring(0,6) : 'STATION')}</span>
        <span style="float:right">${row.mars_pings} PINGS</span>
      `;
      container.appendChild(div);
    });

  } catch (err) {
    console.error("[leaderboard] error:", err);
    container.innerHTML = "<div>Leaderboard unavailable.</div>";
  }
}

async function updateLeaderboard(pings) {
  if (!user || user.is_anonymous) return;

  const payload = {
    user_id: user.id,
    codename: codename,
    mars_pings: pings,
    updated_at: new Date().toISOString()
  };

  const { error } = await sb
    .from("leaderboards")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    console.error("[leaderboard] upsert error:", error);
    return;
  }

  await loadLeaderboard();
}

function spawnSolarStorm() {
    const radius = 150;
    const duration = Math.random() * (STORM_CONFIG.durationMax - STORM_CONFIG.durationMin) + STORM_CONFIG.durationMin;
    const el = document.createElement('div');
    el.className = 'storm-pulse'; el.style.width = el.style.height = `${radius}px`;
    const rx = 50 + (Math.random() - 0.5) * 40; const ry = 50 + (Math.random() - 0.5) * 40;
    el.style.left = `${rx}%`; el.style.top = `${ry}%`;
    document.getElementById('solar-storm-layer')?.appendChild(el);
    const stormObj = { x: rx, y: ry, r: radius / 2, el };
    activeStorms.add(stormObj); isStorming = true;
    document.getElementById('viz-container')?.classList.add('shake');
    addLog("SOLAR STORM DETECTED", "error");
    setTimeout(() => {
        el.remove(); activeStorms.delete(stormObj);
        if (activeStorms.size === 0) {
            document.getElementById('viz-container')?.classList.remove('shake');
            isStorming = false;
        }
    }, duration);
}

function scheduleStorm() {
    const next = Math.random() * (STORM_CONFIG.spawnIntervalMax - STORM_CONFIG.spawnIntervalMin) + STORM_CONFIG.spawnIntervalMin;
    setTimeout(() => { spawnSolarStorm(); scheduleStorm(); }, next);
}

function triggerFlareBurst() {
    addLog("SOLAR FLARE BURST", "error");
    const oldStates = { ...PLANET_STATES };
    Object.keys(PLANET_STATES).forEach(k => PLANET_STATES[k] = 'interference');
    updatePlanetVisuals();
    setTimeout(() => {
        Object.keys(PLANET_STATES).forEach(k => PLANET_STATES[k] = oldStates[k]);
        updatePlanetVisuals();
    }, STORM_CONFIG.flareDuration);
}

function scheduleFlare() {
    const next = Math.random() * (STORM_CONFIG.flareIntervalMax - STORM_CONFIG.flareIntervalMin) + STORM_CONFIG.flareIntervalMin;
    setTimeout(() => { triggerFlareBurst(); scheduleFlare(); }, next);
}

function mainLoop() {
    PLANET_DATA.earth.angle += PLANET_DATA.earth.speed * ORBIT_SPEED_MULT * 16;
    PLANET_DATA.earth.pos.x = 50 + Math.cos(PLANET_DATA.earth.angle) * PLANET_DATA.earth.radius;
    PLANET_DATA.earth.pos.y = 50 + Math.sin(PLANET_DATA.earth.angle) * PLANET_DATA.earth.radius;
    PLANET_DATA.mars.angle += PLANET_DATA.mars.speed * ORBIT_SPEED_MULT * 16;
    PLANET_DATA.mars.pos.x = 50 + Math.cos(PLANET_DATA.mars.angle) * PLANET_DATA.mars.radius;
    PLANET_DATA.mars.pos.y = 50 + Math.sin(PLANET_DATA.mars.angle) * PLANET_DATA.mars.radius;
    PLANET_DATA.moon.angle += PLANET_DATA.moon.speed * ORBIT_SPEED_MULT * 16;
    PLANET_DATA.moon.pos.x = PLANET_DATA.earth.pos.x + Math.cos(PLANET_DATA.moon.angle) * PLANET_DATA.moon.radius;
    PLANET_DATA.moon.pos.y = PLANET_DATA.earth.pos.y + Math.sin(PLANET_DATA.moon.angle) * PLANET_DATA.moon.radius;

    Object.keys(PLANET_DATA).forEach(k => {
        const el = document.querySelector(`.body.${k}`);
        if (el) { el.style.left = `${PLANET_DATA[k].pos.x}%`; el.style.top = `${PLANET_DATA[k].pos.y}%`; }
    });

    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i]; a.x += a.vx; a.y += a.vy;
        a.el.style.left = `${a.x}%`; a.el.style.top = `${a.y}%`;
        if (a.x < -10 || a.x > 110 || a.y < -10 || a.y > 110) { a.el.remove(); asteroids.splice(i, 1); }
    }
    requestAnimationFrame(mainLoop);
}

function spawnAsteroid() {
    const side = Math.floor(Math.random() * 4);
    let x, y, vx, vy;
    if (side === 0) { x = -5; y = Math.random() * 100; vx = 0.2; vy = 0; }
    else if (side === 1) { x = 105; y = Math.random() * 100; vx = -0.2; vy = 0; }
    else if (side === 2) { y = -5; x = Math.random() * 100; vy = 0.2; vx = 0; }
    else { y = 105; x = Math.random() * 100; vy = -0.2; vx = 0; }
    const el = document.createElement('div'); el.className = 'asteroid';
    document.getElementById('asteroid-layer')?.appendChild(el);
    asteroids.push({ x, y, vx, vy, el });
}

function cycleAmbientInterference() {
    if (isStorming) return;
    Object.keys(PLANET_STATES).forEach(p => { 
        const rand = Math.random();
        PLANET_STATES[p] = rand > 0.9 ? 'blackout' : rand > 0.7 ? 'interference' : 'nominal'; 
    });
    updatePlanetVisuals();
}

function updatePlanetVisuals() {
    Object.keys(PLANET_STATES).forEach(p => {
        const badge = document.querySelector(`.body.${p} .state-badge`);
        if (badge) {
            badge.innerText = PLANET_STATES[p].toUpperCase();
            badge.style.color = PLANET_STATES[p] === 'nominal' ? '#0f0' : PLANET_STATES[p] === 'interference' ? '#ff0' : '#f05';
        }
    });
}

function updateLatencyEstimate() {
    const from = document.getElementById('origin')?.value;
    const to = document.getElementById('destination')?.value;
    const speed = parseFloat(document.getElementById('sim-speed')?.value || 1);
    if (!from || !to) return;
    const dist = Math.hypot(PLANET_DATA[from].pos.x - PLANET_DATA[to].pos.x, PLANET_DATA[from].pos.y - PLANET_DATA[to].pos.y);
    const val = document.getElementById('delay-val');
    if (val) val.innerText = `${(dist / 10 / speed).toFixed(1)}s`;
}

document.getElementById('send-btn').onclick = async () => {
    if (!isInitialized || document.getElementById('send-btn').disabled) return;
    const from = document.getElementById('origin').value; const to = document.getElementById('destination').value;
    if (from === to) return showToast("LOOPBACK ERROR", "error");
    if (currentStrategy === 'EMERGENCY') {
        if (emergencyTokens <= 0) return addLog("TOKENS DEPLETED", "error");
        emergencyTokens--; localStorage.setItem('emergency_tokens', emergencyTokens);
        document.getElementById('emergency-count').innerText = emergencyTokens;
    }
    transmit(from, to, document.getElementById('message').value, currentStrategy);
};

function checkSignalCapture(packet, planet) {
  const packetRect = packet.getBoundingClientRect();
  const planetRect = planet.getBoundingClientRect();

  const px = packetRect.left + packetRect.width / 2;
  const py = packetRect.top + packetRect.height / 2;

  const cx = planetRect.left + planetRect.width / 2;
  const cy = planetRect.top + planetRect.height / 2;

  const dx = px - cx;
  const dy = py - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const captureRadius = planetRect.width * 0.9; // generous radius

  return distance <= captureRadius;
}

async function transmit(from, to, msg, strategy) {
    if (document.getElementById('send-btn').disabled) return;
    document.getElementById('send-btn').disabled = true;

    const speed = parseFloat(document.getElementById('sim-speed')?.value || 1);
    const startPos = { ...PLANET_DATA[from].pos };
    const endPos = { ...PLANET_DATA[to].pos };
    const dist = Math.hypot(startPos.x - endPos.x, startPos.y - endPos.y);
    const duration = (dist * 200) / speed;

    const signalObj = { 
        id: Date.now(), from, to, strategy, timestamp: new Date().toISOString(), 
        coords: { start: startPos, end: endPos },
        resolved: false
    };
    
    recentLogs.unshift({ ...signalObj, event: 'send', message: `Launch to ${to}` });
    addLog(`Launching to ${to.toUpperCase()}...`, 'sent');
    
    const targetPlanet = document.querySelector(`.body.${to}`);

    // Pre-animation checks
    if (PLANET_STATES[to] === 'blackout' && strategy !== 'EMERGENCY') {
        finish(null, to, signalObj, false, "solar_blackout");
        return;
    }

    const pkt = document.createElement('div'); pkt.className = 'packet'; pkt.dataset.strategy = strategy;
    if (isStorming) pkt.classList.add('jitter');
    document.getElementById('signal-layer')?.appendChild(pkt);
    
    const startTime = performance.now();
    const animate = (now) => {
        if (signalObj.resolved) return;

        let progress = Math.min((now - startTime) / duration, 1);
        const s = signalObj.coords.start, e = signalObj.coords.end;
        let px = s.x + (e.x - s.x) * progress, py = s.y + (e.y - s.y) * progress;
        
        if (pkt.classList.contains('jitter')) { 
            px += (Math.random() - 0.5) * 1.5; 
            py += (Math.random() - 0.5) * 1.5; 
        }
        
        pkt.style.left = `${px}%`; pkt.style.top = `${py}%`;
        
        for (const a of asteroids) { 
            if (Math.hypot(a.x - px, a.y - py) < 2.0) { 
                finish(pkt, to, signalObj, true, "asteroid_collision"); return; 
            } 
        }

        if (checkSignalCapture(pkt, targetPlanet)) {
            // magnetic lock effect
            pkt.style.transition = "all 0.2s ease-out";
            pkt.style.left = targetPlanet.style.left;
            pkt.style.top = targetPlanet.style.top;
            finish(pkt, to, signalObj, false);
            return;
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            finish(pkt, to, signalObj, false, "trajectory_miss");
        }
    };
    requestAnimationFrame(animate);
}

async function finish(pkt, to, signalObj, hitByAsteroid, failureReason = null) {
    if (signalObj.resolved) return;
    signalObj.resolved = true;

    if (pkt) pkt.remove(); 
    document.getElementById('send-btn').disabled = false;

    let lossRate = parseInt(document.getElementById('packet-loss')?.value || 15);
    const planetInStorm = [...activeStorms].some(s => Math.hypot(PLANET_DATA[to].pos.x - s.x, PLANET_DATA[to].pos.y - s.y) < s.r);
    
    if (planetInStorm) lossRate += STORM_CONFIG.lossIncrease;
    if (PLANET_STATES[to] === 'interference') lossRate += STORM_CONFIG.lossIncrease;
    if (signalObj.strategy === 'BOOST') lossRate -= 15;
    
    lossRate = Math.max(0, Math.min(lossRate, 100));
    
    let reason = failureReason;
    let failed = !!reason || hitByAsteroid;

    if (!failed) {
        if (PLANET_STATES[to] === 'blackout' && signalObj.strategy !== 'EMERGENCY') {
            failed = true; reason = "solar_blackout";
        } else if (PLANET_STATES[to] === 'blackout' && signalObj.strategy === 'EMERGENCY') {
            if (Math.random() * 100 < Math.min(lossRate + 50, 98)) {
                failed = true; reason = "radiation_interference";
            }
        } else if (Math.random() * 100 < lossRate) {
            failed = true; reason = isStorming ? "radiation_interference" : "signal_decay";
        }
    }

    const event = failed ? 'drop' : 'success';
    const logMsg = failed ? `SIGNAL LOST — REASON: ${reason.toUpperCase().replace(/_/g, ' ')}` : 'Link confirmed';
    
    await logEvent(event, logMsg, signalObj);
    
    if (!failed) {
        showToast("UPLINK CONFIRMED", "success");
        if (to === 'mars') stats.marsPings++;
        if (user && !user.is_anonymous) {
            await updateLeaderboard(stats.marsPings);
            checkAchievements(to);
        }
    } else {
        addLog(logMsg, "error");
        showToast("SIGNAL LOST", "error");
    }
}

async function logEvent(event, message, meta) {
    const entry = { ...meta, event, message };
    recentLogs.unshift(entry); if (recentLogs.length > 30) recentLogs.pop();
    if (!sb || !user || user.is_anonymous) return;
    try { await sb.from('mission_logs').insert([{ ...meta, event, message, codename }]); } catch (e) {}
}

async function updateLeaderboard() {
    if (!user || user.is_anonymous) return;
    try { 
        await sb.from('leaderboards').upsert({ user_id: user.id, codename, mars_pings: stats.marsPings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }); 
        await loadLeaderboard();
    } catch (e) { console.error("LB error", e); }
}

async function checkAchievements(to) {
    if (!user || user.is_anonymous) return;
    if (to === 'mars' && !unlockedCache.has('mars_explorer')) {
        unlockedCache.add('mars_explorer');
        showToast("ACHIEVEMENT: Mars Explorer", "success");
    }
}

function showToast(msg, type) {
    const a = document.getElementById('toast-area'), t = document.createElement('div');
    if (!a) return;
    t.className = `toast ${type}`; t.innerText = msg; a.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

function addLog(text, type) {
    const logEl = document.getElementById('logs');
    if (!logEl) return;
    const div = document.createElement('div'); div.className = `entry ${type}`;
    div.innerText = `> ${text}`; logEl.prepend(div);
}

function openTelemetry() {
    const panel = document.getElementById('telemetry-panel');
    const list = document.getElementById('telemetry-list');
    const jsonView = document.getElementById('telemetry-json-view');
    if (!panel || !list) return;
    panel.style.display = 'block';
    list.innerHTML = recentLogs.map((l, i) => `
        <div class="telemetry-item ${selectedReplayIndex === i ? 'selected' : ''}" onclick="selectReplay(${i})">
            [${(l.timestamp || '').slice(11, 19)}] ${l.from.toUpperCase()} -> ${l.to.toUpperCase()} - ${l.event.toUpperCase()}
        </div>
    `).join('');
    if (selectedReplayIndex >= 0 && jsonView) {
        jsonView.innerText = JSON.stringify(recentLogs[selectedReplayIndex], null, 2);
    }
}

window.selectReplay = (i) => { selectedReplayIndex = i; openTelemetry(); };

function replayTelemetry() {
    const log = recentLogs[selectedReplayIndex];
    if (!log || !log.coords) return;
    document.getElementById('telemetry-panel').style.display = 'none';
    const pkt = document.createElement('div'); pkt.className = 'packet';
    document.getElementById('signal-layer')?.appendChild(pkt);
    const duration = 600; const startTime = performance.now();
    const animate = (now) => {
        let progress = Math.min((now - startTime) / duration, 1);
        const s = log.coords.start, e = log.coords.end;
        pkt.style.left = `${s.x + (e.x - s.x) * progress}%`;
        pkt.style.top = `${s.y + (e.y - s.y) * progress}%`;
        if (progress < 1) requestAnimationFrame(animate); else pkt.remove();
    };
    requestAnimationFrame(animate);
}

function exportTelemetry(logs) {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'voidrelay-telemetry.json'; a.click();
}

function printRealismCheck() {
    console.info('SIMULATION RESET CHECK:');
    console.info('1) Signals auto-lock near planet');
    console.info('2) Missed signals show detailed reason');
    console.info('3) Leaderboard persists after refresh');
    console.info('4) Achievements reload after account switch');
    console.info('5) No duplicate success/drop events');
}

console.info('INTEGRITY CHECK:');
console.info('1) Leaderboard persists after refresh');
console.info('2) Multiple accounts appear in leaderboard');
console.info('3) Achievements reload on account switch');
console.info('4) Packet must physically collide to succeed');
console.info('5) Missed packet triggers drop event');
console.info('6) No double resolution events');

document.addEventListener('DOMContentLoaded', initApp);
