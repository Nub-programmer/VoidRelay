// Fixed: signup, sliders, orbit, mission logic, leaderboard visibility
// 🚀 VoidRelay Core Logic // 15-yo Hacker Style
// Supabase V2 Setup - Clean & Reliable

const supabaseUrl = window.VOID_SB_URL;
const supabaseKey = window.VOID_SB_KEY;

// A) AUTH / NETWORK ROBUSTNESS
const authErrorEl = document.getElementById('auth-error') || (() => {
    const el = document.createElement('div');
    el.id = 'auth-error';
    el.style.color = '#ff0055';
    el.style.fontSize = '0.8rem';
    el.style.marginTop = '5px';
    document.querySelector('.modal-content')?.appendChild(el);
    return el;
})();

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Supabase config missing. Check your environment, Commander.");
    if (authErrorEl) authErrorEl.innerText = "Supabase config missing";
}

const sb = window.supabase.createClient(supabaseUrl, supabaseKey);

// App State
let user = null;
let codename = localStorage.getItem('void_relay_codename') || 'GUEST';
let stats = { sent: 0, lost: 0, marsPings: 0, stormsSurvived: 0, successStreak: 0, maxStreak: 0, totalAttempts: 0 };
let currentMission = null;
let missionProgress = 0;
let isStorming = false;
let isInitialized = false;
let missionCompletedToday = false;
window.__ORBIT_DEBUG = false; // Orbit debug toggle

// Planet States & Orbits
const PLANET_STATES = { earth: 'NOMINAL', moon: 'NOMINAL', mars: 'NOMINAL' };

// C) PLANETS & ORBITS (visuals)
const PLANETS = {
    earth: { cx: 15, cy: 50, radius: 2, angle: 0, speed: 0.0002, name: "Earth", color: "#2271b1" },
    moon: { cx: 35, cy: 40, radius: 5, angle: Math.PI, speed: 0.001, name: "The Moon", color: "#ccc" },
    mars: { cx: 85, cy: 60, radius: 4, angle: 0, speed: 0.0005, name: "Mars", color: "#c1440e" }
};

const BASE_DELAYS = {
    'earth-moon': 1.3, 'moon-earth': 1.3,
    'earth-mars': 25, 'mars-earth': 25,
    'moon-mars': 23.7, 'mars-moon': 23.7
};

// Operator Choices
let currentStrategy = 'NORMAL';
let lastSendTime = 0;
let emergencyUsed = false;

// DOM Nodes
const logEl = document.getElementById('logs');
const lbEl = document.getElementById('leaderboard-list');
const achEl = document.getElementById('achievements-list');
const sendBtn = document.getElementById('send-btn');
const codenameDisplay = document.getElementById('user-codename');
const authModal = document.getElementById('auth-modal');
const codenameInput = document.getElementById('codename-input');
const passwordInput = document.getElementById('password-input');
const loginBtn = document.getElementById('auth-login');
const signupBtn = document.getElementById('auth-signup');
const guestBtn = document.getElementById('auth-guest');
const logoutBtn = document.getElementById('logout-btn');

// B) SLIDERS & UI INTERACTIONS
function setupSliders() {
    const speedSlider = document.getElementById('sim-speed');
    const lossSlider = document.getElementById('packet-loss');
    const speedLabel = document.getElementById('speed-val');
    const lossLabel = document.getElementById('loss-val');

    if (speedSlider && speedLabel) {
        speedSlider.addEventListener('input', (e) => {
            speedLabel.innerText = `${Math.round(e.target.value)}x`;
        });
    }
    if (lossSlider && lossLabel) {
        lossSlider.addEventListener('input', (e) => {
            lossLabel.innerText = `${e.target.value}%`;
        });
    }
}

// D) STRATEGIES
function injectStrategy() {
    const controls = document.querySelector('.controls');
    if (!controls || document.getElementById('strategy')) return;
    
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
        <label>STRATEGY:</label>
        <select id="strategy">
            <option value="NORMAL">NORMAL (STANDARD)</option>
            <option value="BOOST">BOOST (-15% LOSS, +EFFICIENCY)</option>
            <option value="SYNC">SYNC (ALIGNMENT BONUS)</option>
            <option value="EMERGENCY">EMERGENCY (OVERRIDE +50% CHAOS)</option>
        </select>
    `;
    controls.insertBefore(row, document.querySelector('.sliders'));
    
    document.getElementById('strategy').addEventListener('change', (e) => {
        currentStrategy = e.target.value;
        addLog(`Strategy adjusted: ${currentStrategy}`, 'sys');
    });
}

// A) AUTH / NETWORK ROBUSTNESS (Timeout wrapper)
async function withTimeout(promise, ms = 8000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Network error — retry')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

// Initial boot-up logic
async function init() {
    // narrowly target replit elements to avoid blocking auth
    const nukeBadges = () => {
        document.querySelectorAll('iframe[src*="replit.com/replbadge"], #replit-badge').forEach(el => el.remove());
    };
    setInterval(nukeBadges, 2000);
    nukeBadges();

    if (!sb) return;
    setupSliders();
    injectStrategy();
    startOrbits();

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        user = session.user;
        const { data: profile } = await sb.from('profiles').select('codename').eq('id', user.id).maybeSingle();
        if (profile) {
            codename = profile.codename;
            completeInitialization();
        } else {
            authModal.style.display = 'flex';
        }
    } else {
        authModal.style.display = 'flex';
    }

    signupBtn.onclick = async () => handleAuth('signUp');
    loginBtn.onclick = async () => handleAuth('signInWithPassword');
    
    guestBtn.onclick = () => {
        codename = "GUEST_" + Math.floor(Math.random() * 9999);
        user = null;
        localStorage.setItem('void_relay_codename', codename);
        completeInitialization();
    };

    logoutBtn.onclick = async () => {
        await sb.auth.signOut();
        location.reload();
    };
}

async function handleAuth(method) {
    const name = codenameInput.value.trim();
    const pass = passwordInput.value;
    if (!name || pass.length < 6) {
        authErrorEl.innerText = "Name required & password min 6 chars.";
        return;
    }

    const email = `${name.toLowerCase()}@voidrelay.local`;
    loginBtn.disabled = signupBtn.disabled = true;
    authErrorEl.innerText = "Establishing uplink...";

    try {
        const promise = method === 'signUp' 
            ? sb.auth.signUp({ email, password: pass })
            : sb.auth.signInWithPassword({ email, password: pass });
        
        const { data, error } = await withTimeout(promise);
        
        if (error) throw error;
        
        user = data.user;
        if (method === 'signUp') {
            await sb.from('profiles').insert([{ id: user.id, codename: name }]);
        } else {
            const { data: profile } = await sb.from('profiles').select('codename').eq('id', user.id).single();
            codename = profile ? profile.codename : name;
        }
        completeInitialization();
    } catch (e) {
        console.error('Auth network error', e);
        authErrorEl.innerText = e.message || "Network error — retry";
        loginBtn.disabled = signupBtn.disabled = false;
    }
}

function completeInitialization() {
    isInitialized = true;
    codenameDisplay.innerText = codename;
    authModal.style.display = 'none';
    if (user) logoutBtn.classList.remove('hidden');
    loadDashboard();
}

async function loadDashboard() {
    if (!sb) return;
    if (user && !user.is_anonymous) {
        fetchLogs();
        fetchDailyMission();
        fetchAchievements();
    } else {
        addLog("GUEST MODE: Missions and Leaderboards restricted.", "error");
        document.getElementById('mission-title').innerText = "GUEST RESTRICTED";
    }
    fetchLeaderboard();
    addLog(`Uplink stable. Welcome, ${codename}.`, 'sys');
}

// C) PLANETS & ORBITS (implementation)
function startOrbits() {
    let lastTime = performance.now();
    const animate = (now) => {
        const dt = now - lastTime;
        lastTime = now;
        
        Object.keys(PLANETS).forEach(key => {
            const p = PLANETS[key];
            p.angle += p.speed * dt;
            const x = p.cx + Math.cos(p.angle) * p.radius;
            const y = p.cy + Math.sin(p.angle) * p.radius;
            p.currentX = x;
            p.currentY = y;
            
            const el = document.querySelector(`.body.${key}`);
            if (el) {
                el.style.left = `${x}%`;
                el.style.top = `${y}%`;
            }
        });
        requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
}

// 📦 Supabase Persistence Layer
async function fetchLogs() {
    if (!user || user.is_anonymous) return;
    try {
        const { data } = await sb.from('mission_logs')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);
        logEl.innerHTML = '<div class="entry sys">System booted. Ready to ping.</div>';
        if (data) data.reverse().forEach(l => addLog(`[LOG] ${l.event}: ${l.message}`, 'sys'));
    } catch (e) {
        console.error("Fetch logs failed:", e);
    }
}

async function fetchLeaderboard() {
    // G) LEADERBOARD VISIBILITY
    if (!user || user.is_anonymous) {
        lbEl.innerHTML = '<div class="entry sys">Top stations - sign up to appear here.</div>';
        return;
    }
    try {
        const { data } = await sb.from('leaderboards').select('*').order('missions_completed', { ascending: false }).limit(10);
        if (!data || data.length === 0) {
            lbEl.innerHTML = '<div class="entry sys">No station data found.</div>';
            return;
        }
        lbEl.innerHTML = data.map((entry, idx) => `
            <div class="lb-entry">
                <div class="lb-main">
                    <span class="lb-title">[${idx === 0 ? 'DIRECTOR' : 'OPERATOR'}]</span>
                    <span class="lb-name">${entry.codename}</span>
                </div>
                <div class="lb-stats">
                    <span>SUCCESS: ${entry.success_count || 0}</span>
                    <span>MISSIONS: ${entry.missions_completed || 0}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error("Fetch leaderboard failed:", e);
    }
}

async function fetchDailyMission() {
    if (!user || user.is_anonymous) return;
    try {
        const { data: mission } = await sb.from('daily_missions').select('*').eq('active', true).maybeSingle();
        if (mission) {
            currentMission = mission;
            document.getElementById('mission-title').innerText = mission.title;
            const { data: progress } = await sb.from('user_mission_progress')
                .select('*')
                .eq('user_id', user.id)
                .eq('mission_id', mission.id)
                .maybeSingle();
            missionProgress = progress ? progress.count : 0;
            missionCompletedToday = progress ? progress.completed : false;
            updateMissionUI();
        }
    } catch (e) {
        console.error("Fetch daily mission failed:", e);
    }
}

async function fetchAchievements() {
    if (!user || user.is_anonymous) return;
    try {
        const { data: all } = await sb.from('achievements').select('*');
        const { data: userAchs } = await sb.from('user_achievements').select('achievement_id').eq('user_id', user.id);
        const unlockedIds = new Set(userAchs?.map(a => a.achievement_id));
        achEl.innerHTML = all ? all.map(a => {
            const isUnlocked = unlockedIds.has(a.id);
            return `<div class="badge ${isUnlocked ? '' : 'locked'}">${isUnlocked ? '🏆 ' + a.name : '🔒 ???'}</div>`;
        }).join('') : '';
    } catch (e) {
        console.error("Fetch achievements failed:", e);
    }
}

// 🚀 Simulator Core Logic
sendBtn.onclick = async () => {
    if (!isInitialized || sendBtn.disabled) return;
    const from = document.getElementById('origin').value;
    const to = document.getElementById('destination').value;
    if (from === to) return addLog("Talking to yourself isn't productive.", "error");
    transmit(from, to);
};

async function transmit(from, to) {
    stats.totalAttempts++;
    sendBtn.disabled = true;
    
    // B) SLIDERS & UI INTERACTIONS (Read at transmit time)
    const speed = parseFloat(document.getElementById('sim-speed').value);
    const baseWait = BASE_DELAYS[`${from}-${to}`] || 5;
    const duration = (baseWait / speed) * 1000;
    
    // D) STRATEGIES (Sync timing)
    const now = performance.now();
    let syncBonus = false;
    if (currentStrategy === 'SYNC' && lastSendTime > 0 && (now - lastSendTime) > 1500) {
        syncBonus = true;
        addLog("SYNC ALIGNMENT BONUS ACTIVE", "success");
    }
    lastSendTime = now;

    addLog(`Beaming signal to ${PLANETS[to].name}...`, 'sent');
    // E) SIGNAL METADATA & LOGGING
    await logEvent('send', `Signal launched from ${from} to ${to}`, { from, to });

    const pkt = document.createElement('div');
    pkt.className = 'packet';
    document.getElementById('signal-layer').appendChild(pkt);

    const startTime = performance.now();
    const animate = (currentTime) => {
        let progress = Math.min((currentTime - startTime) / duration, 1);
        
        // C) PLANETS & ORBITS (Dynamic trajectory)
        const start = PLANETS[from];
        const end = PLANETS[to];
        pkt.style.left = `${start.currentX + (end.currentX - start.currentX) * progress}%`;
        pkt.style.top = `${start.currentY + (end.currentY - start.currentY) * progress}%`;
        
        if (progress < 1) requestAnimationFrame(animate);
        else finish(pkt, to, from, syncBonus);
    };
    requestAnimationFrame(animate);
}

async function finish(pkt, to, from, syncBonus) {
    // D) STRATEGIES (Loss rate transforms)
    let lossRate = parseInt(document.getElementById('packet-loss').value);
    if (currentStrategy === 'BOOST') lossRate -= 15;
    if (syncBonus) lossRate -= 10;
    if (currentStrategy === 'EMERGENCY') {
        if (!emergencyUsed) {
            lossRate = 5; // Override high success
            emergencyUsed = true;
            addLog("EMERGENCY OVERRIDE CONSUMED", "sys");
        } else {
            lossRate += 50; // Chaos penalty if already used
        }
    }
    
    if (PLANET_STATES[to] === 'INTERFERENCE') lossRate += 20;
    if (isStorming) lossRate += 40;
    
    const failed = Math.random() * 100 < lossRate;
    if (failed) {
        stats.lost++;
        stats.successStreak = 0;
        addLog(`Signal vanished near ${PLANETS[to].name} 👀`, 'error');
        await logEvent('drop', `Signal lost near ${to}`, { from, to });
    } else {
        stats.sent++;
        stats.successStreak++;
        addLog(`Signal confirmed at ${PLANETS[to].name}! 🚀`, 'success');
        if (to === 'mars') stats.marsPings++;
        await logEvent('success', `Signal delivered to ${to}`, { from, to });
        checkAchievements(to);
        await updateMissionProgress(to, from);
        await updateLeaderboard();
    }
    pkt.remove();
    sendBtn.disabled = false;
}

function addLog(text, type) {
    const div = document.createElement('div');
    div.className = `entry ${type}`;
    div.innerText = `> ${text}`;
    logEl.prepend(div);
}

// E) SIGNAL METADATA & LOGGING
async function logEvent(event, message, metadata = {}) {
    if (!sb) return;
    try {
        await sb.from('mission_logs').insert([{ 
            user_id: user && !user.is_anonymous ? user.id : null, 
            event, 
            message, 
            codename,
            timestamp: new Date().toISOString(),
            strategy: currentStrategy,
            ...metadata
        }]);
    } catch (e) {
        console.error("Log insert failed", e);
        // subtle toast could go here
    }
}

// G) LEADERBOARD VISIBILITY
async function updateLeaderboard() {
    if (!sb || !user || user.is_anonymous) return;
    try {
        const { data: currentLB } = await sb.from('leaderboards').select('missions_completed').eq('id', user.id).maybeSingle();
        let completedCount = currentLB ? currentLB.missions_completed : 0;
        if (currentMission && missionProgress >= currentMission.target && !missionCompletedToday) {
            completedCount++;
            missionCompletedToday = true;
        }
        await sb.from('leaderboards').upsert({ 
            id: user.id, 
            codename, 
            mars_pings: stats.marsPings,
            missions_completed: completedCount,
            sent_count: stats.totalAttempts,
            success_count: stats.sent,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        fetchLeaderboard();
    } catch (e) {
        console.error("Leaderboard upsert failed", e);
    }
}

// F) MISSION LOGIC
async function updateMissionProgress(destination, origin) {
    if (!currentMission || !user || user.is_anonymous || missionCompletedToday) return;
    
    let valid = currentMission.target_planet === destination;
    if (currentMission.title.toLowerCase().includes('mars') && destination !== 'mars') valid = false;

    if (!valid) return;

    missionProgress++;
    try {
        await sb.from('user_mission_progress').upsert({
            user_id: user.id,
            count: missionProgress,
            mission_id: currentMission.id,
            completed: missionProgress >= currentMission.target
        }, { onConflict: 'user_id,mission_id' });
        updateMissionUI();
    } catch (e) {
        console.error("Mission upsert failed", e);
    }
}

function updateMissionUI() {
    const target = currentMission?.target || 1;
    const current = Math.min(missionProgress, target);
    const perc = (current / target) * 100;
    document.getElementById('mission-progress').style.width = `${perc}%`;
    document.getElementById('mission-status').innerText = `${current}/${target}`;
}

async function checkAchievements(to) {
    if (!user || user.is_anonymous) return;
    if (to === 'mars' && stats.marsPings === 1) unlockAchievement('mars_first');
    if (isStorming) unlockAchievement('storm_survivor');
}

async function unlockAchievement(key) {
    if (!sb || !user || user.is_anonymous) return;
    try {
        const { data: ach } = await sb.from('achievements').select('id').eq('key', key).single();
        if (ach) {
            const { data: existing } = await sb.from('user_achievements').select('*').eq('user_id', user.id).eq('achievement_id', ach.id).maybeSingle();
            if (!existing) {
                await sb.from('user_achievements').insert({ user_id: user.id, achievement_id: ach.id });
                fetchAchievements();
            }
        }
    } catch (e) {
        console.error("Achievement insert failed", e);
    }
}

setInterval(() => {
    if (Math.random() < 0.05 && !isStorming) {
        isStorming = true;
        document.getElementById('storm-warning').classList.remove('hidden');
        addLog("CRITICAL: Solar radiation spike!", "error");
        setTimeout(() => {
            isStorming = false;
            document.getElementById('storm-warning').classList.add('hidden');
            addLog("Radiation normalizing.", "sys");
        }, 8000);
    }
}, 30000);

document.addEventListener('DOMContentLoaded', init);
console.info("VoidRelay debug checklist ready: auth, sliders, orbits");
