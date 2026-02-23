// VoidRelay - deep space comms simulator with actual physics n stuff
// Supabase setup - this connects us to the database for auth and leaderboard
const supabaseUrl = window.VOID_SB_URL;
const supabaseKey = window.VOID_SB_KEY;

let sb;
if (supabaseKey && supabaseUrl) {
    sb = window.supabase.createClient(supabaseUrl, supabaseKey);
} else {
    console.error("Yo database config is missing, check your keys");
}

// How fast planets orbit - tweak this if you want things to move faster/slower
const ORBIT_SPEED_MULT = 0.0008;
const ORBIT_RAD_EARTH = 15;
const ORBIT_RAD_MARS = 35;
const ORBIT_RAD_MOON = 6;

// Storm settings - basically how often they spawn and how bad they are
const STORM_CONFIG = {
    spawnIntervalMin: 30000,     // Earliest a storm can spawn (30 sec)
    spawnIntervalMax: 90000,     // Latest a storm can spawn (90 sec)
    durationMin: 5000,           // Shortest storm duration
    durationMax: 9000,           // Longest storm duration
    lossIncrease: 25,            // How much packet loss goes up during storms
    flareIntervalMin: 180000,    // Min time between solar flares (3 min)
    flareIntervalMax: 420000,    // Max time between solar flares (7 min)
    flareDuration: 4000          // How long flares last (4 sec)
};

// Planet setup - where they start and how fast they move
const PLANET_DATA = {
    earth: { name: 'Earth', angle: 0, speed: 0.5, radius: ORBIT_RAD_EARTH, pos: { x: 50, y: 50 } },
    mars: { name: 'Mars', angle: Math.PI, speed: 0.2, radius: ORBIT_RAD_MARS, pos: { x: 50, y: 50 } },
    moon: { name: 'Moon', angle: 0, speed: 2.0, radius: ORBIT_RAD_MOON, pos: { x: 0, y: 0 } }
};

const PLANET_STATES = { earth: 'nominal', moon: 'nominal', mars: 'nominal' };

// Current session data - who's logged in, what they've done
let user = null;
let codename = localStorage.getItem('void_relay_codename') || 'GUEST';
let stats = { marsPings: 0 };
let sessionStats = { successful: 0, failed: 0 };
let isStorming = false;
let isInitialized = false;
let emergencyTokens = parseInt(localStorage.getItem('emergency_tokens')) || 2;
let currentStrategy = 'NORMAL';
let recentLogs = [];
let selectedReplayIndex = -1;
let unlockedCache = new Set();

// Active hazards floating around the simulation
const asteroids = [];
const activeStorms = new Set();

// ========================================================
// APP INITIALIZATION - where everything starts
// ========================================================

async function initApp() {
    console.log('Starting up the simulation...');
    if (!sb) return;

    // Listen for auth changes so we know when someone logs in/out
    sb.auth.onAuthStateChange((event, session) => {
        console.log('Auth event happened:', event);
        user = session?.user || null;
        resetUIState();
        initDataForUser();
    });

    // Check if someone's already logged in from before
    const { data: { session } } = await sb.auth.getSession();
    user = session?.user || null;

    setupStaticUI();
    initDataForUser();

    isInitialized = true;
    requestAnimationFrame(mainLoop);
    
    // Background tasks that keep the simulation interesting
    setInterval(cycleAmbientInterference, 20000);  // Planet states change every 20s
    setInterval(() => { if (Math.random() < 0.4) spawnAsteroid(); }, 30000);  // Random asteroids
    scheduleStorm();  // Solar storms on a timer
    scheduleFlare();  // Solar flares too
}

function resetUIState() {
    console.log('Clearing the UI and resetting everything');
    const lblist = document.getElementById('leaderboard-list');
    if (lblist) lblist.innerHTML = '';
    recentLogs = [];
    sessionStats = { successful: 0, failed: 0 };
    updateIntelligenceConsole();
}

async function initDataForUser() {
    console.log('Loading user data for:', user?.id || 'guest');
    if (user && !user.is_anonymous) {
        try {
            // Try to get their codename from the profiles table
            const { data: profile, error } = await sb.from('profiles').select('codename').eq('id', user.id).maybeSingle();
            if (error) throw error;
            codename = profile ? profile.codename : 'OPERATOR';
        } catch (e) {
            console.error('Profile fetch failed:', e);
            codename = 'OPERATOR';
        }
    } else {
        codename = localStorage.getItem('void_relay_codename') || 'GUEST';
    }
    updateUIState();
    await loadLeaderboard();
    updateIntelligenceConsole();
}

async function handleAuth(mode) {
    const usernameInput = document.getElementById('codename-input');
    const passwordInput = document.getElementById('password-input');
    const errorDisplay = document.getElementById('auth-error');
    
    if (!sb) {
        if (errorDisplay) errorDisplay.innerText = 'Database connection unavailable';
        return;
    }
    
    const username = usernameInput?.value.trim();
    const password = passwordInput?.value;
    
    if (!username || !password) {
        if (errorDisplay) errorDisplay.innerText = 'Missing credentials';
        return;
    }
    
    // We use fake email format since Supabase needs emails but we just want usernames
    const email = `${username}@voidrelay.local`;
    
    try {
        let result;
        if (mode === 'login') {
            result = await sb.auth.signInWithPassword({ email, password });
        } else {
            // Signup flow - create the user and their profile
            result = await sb.auth.signUp({ email, password });
            if (result.data.user) {
                await sb.from('profiles').insert([{ id: result.data.user.id, codename: username }]);
            }
        }
        
        if (result.error) throw result.error;
        
        codename = username;
        localStorage.setItem('void_relay_codename', username);
        
        // Clean up the form
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (errorDisplay) errorDisplay.innerText = '';
        
    } catch (err) {
        console.error('Auth error:', err);
        if (errorDisplay) errorDisplay.innerText = err.message || 'Auth failed';
    }
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



function updateIntelligenceConsole() {
    const successEl = document.getElementById('intel-success');
    const failedEl = document.getElementById('intel-failed');
    const stabilityEl = document.getElementById('intel-stability');
    const hazardEl = document.getElementById('intel-hazard');
    const difficultyEl = document.getElementById('intel-difficulty');
    
    if (successEl) successEl.innerText = sessionStats.successful;
    if (failedEl) failedEl.innerText = sessionStats.failed;
    
    // Calculate stability percentage
    const total = sessionStats.successful + sessionStats.failed;
    const stability = total === 0 ? 100 : Math.round((sessionStats.successful / total) * 100);
    if (stabilityEl) stabilityEl.innerText = `${stability}%`;
    
    // Show current hazard status
    let hazardStatus = 'CLEAR';
    if (isStorming) hazardStatus = 'STORM';
    else if (Object.values(PLANET_STATES).some(s => s === 'blackout')) hazardStatus = 'BLACKOUT';
    else if (Object.values(PLANET_STATES).some(s => s === 'interference')) hazardStatus = 'INTERFERENCE';
    if (hazardEl) hazardEl.innerText = hazardStatus;
    
    // Show difficulty based on current conditions
    let difficulty = 'STANDARD';
    if (isStorming && Object.values(PLANET_STATES).some(s => s === 'blackout')) difficulty = 'EXTREME';
    else if (isStorming || Object.values(PLANET_STATES).some(s => s === 'blackout')) difficulty = 'HIGH';
    if (difficultyEl) difficultyEl.innerText = difficulty;
}

// ========================================================
// UI SETUP - buttons, listeners, all the interactive bits
// ========================================================

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

    const loginBtn = document.getElementById('auth-login');
    const signupBtn = document.getElementById('auth-signup');
    const guestBtn = document.getElementById('auth-guest');
    const logoutBtn = document.getElementById('logout-btn');
    const sendBtn = document.getElementById('send-btn');
    
    if (loginBtn) loginBtn.onclick = () => handleAuth('login');
    if (signupBtn) signupBtn.onclick = () => handleAuth('signup');
    if (guestBtn) guestBtn.onclick = async () => {
        codename = "GUEST_" + Math.floor(Math.random() * 9999);
        user = { is_anonymous: true };
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.style.display = 'none';
        resetUIState();
        await initDataForUser();
    };
    if (logoutBtn) logoutBtn.onclick = async () => { 
        await sb.auth.signOut();
    };
    if (sendBtn) {
        sendBtn.onclick = async () => {
            if (!isInitialized || sendBtn.disabled) return;
            const from = document.getElementById('origin')?.value;
            const to = document.getElementById('destination')?.value;
            if (from === to) return showToast("LOOPBACK ERROR", "error");
            if (currentStrategy === 'EMERGENCY') {
                if (emergencyTokens <= 0) return addLog("TOKENS DEPLETED", "error");
                emergencyTokens--;
                localStorage.setItem('emergency_tokens', emergencyTokens);
                document.getElementById('emergency-count').innerText = emergencyTokens;
            }
            transmit(from, to, document.getElementById('message')?.value || '', currentStrategy);
        };
    }
}

async function logEvent(event, message, meta) {
    // Save this transmission to local history for the telemetry viewer
    const entry = { ...meta, event, message, timestamp: new Date().toISOString() };
    recentLogs.unshift(entry);
    if (recentLogs.length > 30) recentLogs.pop();
    
    // Also save to database if we're logged in (not guest mode)
    if (!sb || !user || user.is_anonymous) return;
    
    try {
        await sb.from('mission_logs').insert([{
            user_id: user.id,
            codename: codename,
            event: event,
            message: message,
            from_planet: meta.from,
            to_planet: meta.to,
            strategy: meta.strategy
        }]);
    } catch (e) {
        console.error('Failed to save mission log:', e);
    }
}

async function checkAchievements(target) {
    if (!user || user.is_anonymous) return;
    
    // Simple achievement check - can be expanded
    if (target === 'mars' && stats.marsPings === 1) {
        console.log('[achievements] First Mars ping - unlocking achievement');
        // In a real implementation, this would unlock the achievement in the database
    }
}

// ========================================================
// ENVIRONMENT & HAZARDS - storms, flares, asteroids
// ========================================================

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
    document.getElementById('viz-container')?.classList.add('shake');  // Screen shake effect
    addLog("SOLAR STORM DETECTED", "error");
    updateIntelligenceConsole();
    setTimeout(() => {
        el.remove(); activeStorms.delete(stormObj);
        if (activeStorms.size === 0) {
            document.getElementById('viz-container')?.classList.remove('shake');
            isStorming = false;
            updateIntelligenceConsole();
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
    // Flare hits all planets at once with interference
    Object.keys(PLANET_STATES).forEach(k => PLANET_STATES[k] = 'interference');
    updatePlanetVisuals();
    updateIntelligenceConsole();
    // Flare only lasts a few seconds then go back to normal states
    setTimeout(() => {
        Object.keys(PLANET_STATES).forEach(k => PLANET_STATES[k] = oldStates[k]);
        updatePlanetVisuals();
        updateIntelligenceConsole();
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
    updateIntelligenceConsole();
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

async function loadLeaderboard() {
    const container = document.getElementById("leaderboard-list");
    if (!container) return;
    container.innerHTML = "";

    // Make sure database is actually connected
    if (!sb) {
        console.warn("Database not initialized, showing offline mode");
        container.innerHTML = "<div>Database unavailable (offline mode).</div>";
        return;
    }

    try {
        // Fetch ALL users from the leaderboard table, sorted by uplinks
        const { data, error } = await sb
            .from("leaderboard")
            .select("user_id, codename, mars_pings")
            .order("mars_pings", { ascending: false });

        if (error) {
            console.error("Leaderboard query failed:", error);
            throw error;
        }

        if (!data || data.length === 0) {
            container.innerHTML = "<div>No operators yet.</div>";
            return;
        }

        // Only show top 5 on main page to keep it clean
        const topFive = data.slice(0, 5);
        
        topFive.forEach((row, index) => {
            const div = document.createElement("div");
            div.className = 'entry';
            div.innerHTML = `
                <span>#${index+1} ${row.codename || (row.user_id ? row.user_id.substring(0,6) : 'STATION')}</span>
                <span style="float:right">${row.mars_pings} UPLINKS</span>
            `;
            container.appendChild(div);
        });

        // If there's more than 5 people, add a link to see everyone
        if (data.length > 5) {
            const btnDiv = document.createElement("div");
            btnDiv.style.marginTop = "0.8rem";
            btnDiv.style.textAlign = "center";
            const btn = document.createElement("button");
            btn.id = "view-full-leaderboard";
            btn.className = "btn-pill";
            btn.innerText = "➡️ See Full Rankings";
            btn.style.padding = "0.5rem 1rem";
            btn.style.cursor = "pointer";
            btn.style.width = "100%";
            btn.onclick = () => {
                window.location.href = "leaderboard.html";
            };
            btnDiv.appendChild(btn);
            container.appendChild(btnDiv);
        }

    } catch (err) {
        console.error("Leaderboard error:", err);
        container.innerHTML = `<div>Leaderboard unavailable: ${err.message || 'Unknown error'}</div>`;
    }
}

async function updateLeaderboard(pings) {
    // Don't update for guests or if not logged in
    if (!user || user.is_anonymous) return;
    if (!sb) {
        console.warn("Database not available, can't sync leaderboard");
        return;
    }

    // Prep the data to send
    const payload = {
        user_id: user.id,
        codename: codename,
        mars_pings: pings,  // Total successful uplinks
        storms_survived: 0   // Future feature maybe
    };

    try {
        // Upsert = update if user exists, insert if new
        const { error } = await sb
            .from("leaderboard")
            .upsert(payload, { onConflict: "user_id" });

        if (error) {
            console.error("Leaderboard upsert failed:", error);
            addLog("Leaderboard sync failed", "error");
            return;
        }

        console.log("Leaderboard updated:", codename, "→", pings, "uplinks");
        // Refresh the display to show new rankings
        await loadLeaderboard();
    } catch (err) {
        console.error("Leaderboard error:", err);
        addLog("Leaderboard sync unavailable", "error");
    }
}

async function transmit(from, to, msg, strategy) {
    // Yo so basically this function handles sending a signal between planets
    console.log('[transmit] Called with:', { from, to, msg, strategy });
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn?.disabled) return;  // Don't let people spam-click it
    if (sendBtn) sendBtn.disabled = true;
    
    const speed = parseFloat(document.getElementById('sim-speed')?.value || 1);
    const startPos = { ...PLANET_DATA[from].pos };
    const endPos = { ...PLANET_DATA[to].pos };
    const dist = Math.hypot(startPos.x - endPos.x, startPos.y - endPos.y);
    const duration = (dist * 200) / speed;  // Travel time scales with distance
    
    // Build the signal state object - this tracks everything about this transmission
    const signalState = {
        id: Date.now(),
        from: from,
        to: to,
        strategy: strategy,
        timestamp: new Date().toISOString(),
        coords: { start: startPos, end: endPos },
        resolved: false, // Super important - prevents double-counting
        state: 'launched'
    };
    
    console.log('[signal] Launching signal:', signalState.id, from, '→', to);
    addLog(`Launching to ${to.toUpperCase()}...`, 'sent');
    
    const targetPlanet = document.querySelector(`.body.${to}`);
    
    // Pre-flight check: if the target planet is in blackout and you're not using emergency mode, just block it immediately
    if (PLANET_STATES[to] === 'blackout' && strategy !== 'EMERGENCY') {
        console.log('[signal] Blocked by solar blackout');
        resolveSignal(null, targetPlanet, signalState, 'failed', 'solar_blackout');
        return;
    }
    
    // Create visual packet
    const pkt = document.createElement('div');
    pkt.className = 'packet';
    pkt.dataset.strategy = strategy;
    if (isStorming) pkt.classList.add('jitter');
    document.getElementById('signal-layer')?.appendChild(pkt);
    
    signalState.state = 'in_flight';
    
    // Animation loop
    const startTime = performance.now();
    const animate = (now) => {
        // Guard: Already resolved
        if (signalState.resolved) return;
        
        let progress = Math.min((now - startTime) / duration, 1);
        const s = signalState.coords.start;
        const e = signalState.coords.end;
        
        let px = s.x + (e.x - s.x) * progress;
        let py = s.y + (e.y - s.y) * progress;
        
        // Apply jitter if storming
        if (pkt.classList.contains('jitter')) {
            px += (Math.random() - 0.5) * 1.5;
            py += (Math.random() - 0.5) * 1.5;
        }
        
        pkt.style.left = `${px}%`;
        pkt.style.top = `${py}%`;
        
        // Collision detection: Check if we hit any asteroids - if so, signal is dead
        for (const a of asteroids) {
            if (Math.hypot(a.x - px, a.y - py) < 2.0) {
                console.log('[signal] Asteroid collision detected');
                resolveSignal(pkt, targetPlanet, signalState, 'failed', 'asteroid_collision');
                return;
            }
        }
        
        // Capture detection: If the signal gets within 80% of the planet's radius, it auto-locks
        // Think of it like a magnetic capture zone - once you're in, you're in
        if (checkSignalCapture(pkt, targetPlanet)) {
            console.log('[signal] Capture detected - magnetic lock');
            signalState.state = 'captured';
            
            // Smooth animation as the signal snaps to the planet
            pkt.style.transition = 'all 0.2s ease-out';
            pkt.style.left = targetPlanet.style.left;
            pkt.style.top = targetPlanet.style.top;
            
            // Let the snap animation finish before we resolve the outcome
            setTimeout(() => {
                resolveSignal(pkt, targetPlanet, signalState, 'success', null);
            }, 200);
            return;
        }
        
        // Keep the animation going, or if we've reached the end and missed, that's an L
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Animation completed but never got captured = we missed the planet entirely
            console.log('[signal] Animation complete without capture - trajectory miss');
            resolveSignal(pkt, targetPlanet, signalState, 'failed', 'trajectory_miss');
        }
    };
    
    requestAnimationFrame(animate);
}

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
    
    // 80% radius = generous capture zone
    const captureRadius = planetRect.width * 0.8;
    
    return distance <= captureRadius;
}

async function resolveSignal(pkt, targetPlanet, signalState, outcome, failureReason) {
    // Critical guard: Only resolve once
    if (signalState.resolved) {
        console.warn('[signal] Attempted double resolution - blocked');
        return;
    }
    
    signalState.resolved = true;
    signalState.state = outcome;
    
    console.log('[signal] Resolving:', outcome, failureReason || 'N/A');
    
    // Clean up visual packet
    if (pkt) pkt.remove();
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.disabled = false;
    
    // Calculate final loss rate with modifiers
    let lossRate = parseInt(document.getElementById('packet-loss')?.value || 15);
    
    const planetInStorm = [...activeStorms].some(s => 
        Math.hypot(PLANET_DATA[signalState.to].pos.x - s.x, PLANET_DATA[signalState.to].pos.y - s.y) < s.r
    );
    
    if (planetInStorm) lossRate += STORM_CONFIG.lossIncrease;
    if (PLANET_STATES[signalState.to] === 'interference') lossRate += STORM_CONFIG.lossIncrease;
    if (signalState.strategy === 'BOOST') lossRate -= 15;
    
    lossRate = Math.max(0, Math.min(lossRate, 100));
    
    // Alright here's where we figure out if the signal actually made it or got cooked
    let finalOutcome = outcome;
    let finalReason = failureReason;
    
    // Run some checks if we got a "success" from capture
    if (outcome === 'success') {
        // Blackout + no emergency? Yeah that's not gonna work chief
        if (PLANET_STATES[signalState.to] === 'blackout' && signalState.strategy !== 'EMERGENCY') {
            finalOutcome = 'failed';
            finalReason = 'solar_blackout';
        } else if (PLANET_STATES[signalState.to] === 'blackout' && signalState.strategy === 'EMERGENCY') {
            // Emergency gives you a shot but it's still pretty rough in blackout
            if (Math.random() * 100 < Math.min(lossRate + 50, 98)) {
                finalOutcome = 'failed';
                finalReason = 'radiation_interference';
            }
        } else if (Math.random() * 100 < lossRate) {
            // Regular packet loss check - storms make this way worse
            finalOutcome = 'failed';
            finalReason = isStorming ? 'radiation_interference' : 'signal_decay';
        }
    }
    
    // Time to log what happened and update everything
    if (finalOutcome === 'success') {
        console.log('[signal] ✓ UPLINK CONFIRMED — TRANSMISSION RECEIVED');
        addLog('UPLINK CONFIRMED — TRANSMISSION RECEIVED', 'success');
        showToast('UPLINK CONFIRMED', 'success');
        
        // Bump up the session success counter
        sessionStats.successful++;
        
        // Update the global ping counter for leaderboard tracking
        stats.marsPings++;
        
        // Push to leaderboard if user is logged in (not guest mode)
        if (user && !user.is_anonymous) {
            await updateLeaderboard(stats.marsPings);
        }
        
        // Log this W to the database
        await logEvent('success', 'Uplink confirmed', signalState);
        
    } else {
        // Signal got cooked somewhere along the way, log the L
        const reasonText = finalReason.toUpperCase().replace(/_/g, ' ');
        console.log(`[signal] ✗ SIGNAL LOST — REASON: ${reasonText}`);
        addLog(`SIGNAL LOST — REASON: ${reasonText}`, 'error');
        showToast('SIGNAL LOST', 'error');
        
        sessionStats.failed++;
        
        // Log the failure with details so we can review it later
        await logEvent('drop', `Signal lost: ${reasonText}`, signalState);
    }
    
    updateIntelligenceConsole();
}

// ========================================================
// HELPER FUNCTIONS - toasts, logs, telemetry stuff
// ========================================================

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

// Start everything when the page loads
document.addEventListener('DOMContentLoaded', initApp);
