// 🚀 VoidRelay Core Logic // 15-yo Hacker Style
// Supabase V2 Setup - Clean & Reliable
const supabaseUrl = window.VOID_SB_URL;
const supabaseKey = window.VOID_SB_KEY;

let sb; // Using 'sb' to avoid collision with 'window.supabase' global

// Proper V2 initialization
if (supabaseKey && supabaseUrl) {
    sb = window.supabase.createClient(supabaseUrl, supabaseKey);
} else {
    console.error("❌ AYO! Supabase URL or Key is missing. Check your secrets, Commander.");
}

// App State
let user = null;
let codename = localStorage.getItem('void_relay_codename') || 'GUEST';
let stats = { sent: 0, lost: 0, marsPings: 0, stormsSurvived: 0 };
let currentMission = null;
let missionProgress = 0;
let isStorming = false;
let isInitialized = false;
let missionCompletedToday = false;

const LOCS = {
    earth: { x: 15, y: 50, name: "Earth" },
    moon: { x: 35, y: 40, name: "The Moon" },
    mars: { x: 85, y: 60, name: "Mars" }
};

const BASE_DELAYS = {
    'earth-moon': 1.3, 'moon-earth': 1.3,
    'earth-mars': 25, 'mars-earth': 25,
    'moon-mars': 23.7, 'mars-moon': 23.7
};

// DOM Nodes
const logEl = document.getElementById('logs');
const lbEl = document.getElementById('leaderboard-list');
const achEl = document.getElementById('achievements-list');
const sendBtn = document.getElementById('send-btn');
const codenameDisplay = document.getElementById('user-codename');
const authModal = document.getElementById('auth-modal');
const codenameInput = document.getElementById('codename-input');
const authSubmitBtn = document.getElementById('auth-submit');

// Initial boot-up logic
async function init() {
    // 🛠️ GEN-Z CLEANUP: Wipe Replit badges every few ms
    const nukeBadges = () => {
        document.querySelectorAll('iframe[src*="replit.com/replbadge"], #replit-badge, .replit-badge, [id*="replit-badge"], [class*="replit-badge"], .replit-watermark, #replit-watermark, .replit-panel, [class*="replit-side-panel"], [id*="replit-side-panel"], div[style*="z-index: 9999999"], div[style*="z-index: 10000000"]')
            .forEach(el => el.remove());
    };
    setInterval(nukeBadges, 500);
    nukeBadges();

    if (!sb) {
        addLog("⚠ uplink unstable — Supabase not configured", "error");
        return;
    }

    // 1. Check for existing session (Persistence check)
    try {
        const { data: { session } } = await sb.auth.getSession();
        
        if (session) {
            user = session.user;
            addLog("✓ session restored from deep space cache", "sys");
        } else {
            const { data: { session: newSession }, error } = await sb.auth.signInAnonymously();
            if (error) throw error;
            user = newSession.user;
            addLog("✓ anonymous session initialized", "sys");
        }
    } catch (e) {
        console.error("Auth failed:", e);
        addLog("⚠ autonomous uplink failed - systems check required", "error");
        return;
    }

    // 2. Restore Identity
    try {
        const { data: profile, error } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
        
        if (profile && profile.codename) {
            codename = profile.codename;
            localStorage.setItem('void_relay_codename', codename);
            completeInitialization();
        } else if (codename !== 'GUEST') {
            // LocalStorage fallback sync
            await sb.from('profiles').upsert([{ id: user.id, codename }]);
            completeInitialization();
        } else {
            authModal.classList.remove('hidden');
            authModal.style.display = 'flex';
        }
    } catch (e) {
        console.error("Identity restoration failed:", e);
        authModal.classList.remove('hidden');
        authModal.style.display = 'flex';
    }

    // 🛠️ "INITIALIZE SESSION" handler
    authSubmitBtn.onclick = async () => {
        if (isInitialized) return;
        
        const input = codenameInput.value.trim();
        if (!input) {
            alert("Commander, you need a callsign to initialize.");
            return;
        }
        
        authSubmitBtn.disabled = true;
        authSubmitBtn.innerText = "INITIALIZING...";
        
        try {
            codename = input;
            localStorage.setItem('void_relay_codename', codename);
            
            // Link profile to auth.uid()
            const { error: upsertError } = await sb.from('profiles').upsert([{ id: user.id, codename }]);
            if (upsertError) throw upsertError;
            
            addLog(`Station ${codename.toUpperCase()} initialized. Link stable.`, "sys");
            completeInitialization();
        } catch (e) {
            console.error("Profile setup failed:", e);
            addLog("Profile setup failed. Retrying sync...", "error");
            authSubmitBtn.disabled = false;
            authSubmitBtn.innerText = "INITIALIZE SESSION";
        }
    };
}

function completeInitialization() {
    isInitialized = true;
    codenameDisplay.innerText = codename;
    authModal.classList.add('hidden');
    // Ensure modal is gone and page is clickable
    authModal.style.display = 'none'; 
    authModal.setAttribute('aria-hidden', 'true');
    authModal.style.pointerEvents = 'none';
    loadDashboard();
}

async function loadDashboard() {
    if (!sb || !user) return;
    fetchLogs();
    fetchLeaderboard();
    fetchDailyMission();
    fetchAchievements();
    addLog(`Welcome back, Commander ${codename}. Systems nominal.`, 'sys');
}

// 📦 Supabase Persistence Layer
async function fetchLogs() {
    if (!user) return;
    try {
        const { data } = await sb.from('mission_logs')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);
        // Use a clean slate for session logs to avoid duplicates on refresh
        logEl.innerHTML = '<div class="entry sys">System booted. Ready to ping.</div>';
        if (data) data.reverse().forEach(l => addLog(`[LOG] ${l.event}: ${l.message}`, 'sys'));
    } catch (e) {
        console.error("Fetch logs failed:", e);
    }
}

async function fetchLeaderboard() {
    try {
        const { data } = await sb.from('leaderboards').select('*').order('missions_completed', { ascending: false }).limit(10);
        if (!data) return;
        lbEl.innerHTML = data.map(entry => `
            <div class="lb-entry">
                <span>${entry.codename}</span>
                <span>${entry.missions_completed || 0} COMPLETED</span>
            </div>
        `).join('');
    } catch (e) {
        console.error("Fetch leaderboard failed:", e);
    }
}

async function fetchDailyMission() {
    if (!user) return;
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
    if (!user) return;
    try {
        const { data: all } = await sb.from('achievements').select('*');
        const { data: userAchs } = await sb.from('user_achievements').select('achievement_id').eq('user_id', user.id);
        const unlockedIds = new Set(userAchs?.map(a => a.achievement_id));

        // Stats sync - get mars pings from leaderboard
        const { data: lbEntry } = await sb.from('leaderboards').select('mars_pings').eq('id', user.id).maybeSingle();
        if (lbEntry) stats.marsPings = lbEntry.mars_pings || 0;

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
    if (!isInitialized || sendBtn.disabled) {
        if (!isInitialized) addLog("Uplink not initialized. Identify yourself first.", "error");
        return;
    }
    const from = document.getElementById('origin').value;
    const to = document.getElementById('destination').value;
    const msg = document.getElementById('message').value.trim() || "Anyone out there?";

    if (from === to) return addLog("Talking to yourself isn't productive, Commander.", "error");

    transmit(from, to, msg);
};

async function transmit(from, to, msg) {
    stats.sent++;
    sendBtn.disabled = true;
    
    const key = `${from}-${to}`;
    const baseWait = BASE_DELAYS[key];
    const speed = parseFloat(document.getElementById('sim-speed').value);
    const duration = (baseWait / speed) * 1000;
    
    addLog(`Beaming signal to ${LOCS[to].name}...`, 'sent');
    await logEvent('send', `Signal launched from ${from} to ${to}`);

    const pkt = document.createElement('div');
    pkt.className = 'packet';
    document.getElementById('signal-layer').appendChild(pkt);

    const start = LOCS[from];
    const end = LOCS[to];
    const startTime = performance.now();
    
    const animate = (now) => {
        let progress = Math.min((now - startTime) / duration, 1);
        pkt.style.left = `${start.x + (end.x - start.x) * progress}%`;
        pkt.style.top = `${start.y + (end.y - start.y) * progress}%`;
        if (progress < 1) requestAnimationFrame(animate);
        else finish(pkt, to, from);
    };
    requestAnimationFrame(animate);
}

async function finish(pkt, to, from) {
    let lossRate = parseInt(document.getElementById('packet-loss').value);
    if (isStorming) lossRate += 40;
    const failed = Math.random() * 100 < lossRate;

    if (failed) {
        stats.lost++;
        addLog(`Uh oh... signal vanished near ${LOCS[to].name} 👀`, 'error');
        await logEvent('drop', `Signal lost near ${to}`);
        pkt.remove();
        sendBtn.disabled = false;
    } else {
        addLog(`Signal confirmed at ${LOCS[to].name}! 🚀`, 'success');
        if (to === 'mars') stats.marsPings++;
        await logEvent('success', `Signal delivered to ${to}`);
        checkAchievements(to);
        await updateMissionProgress();
        await updateLeaderboard();
        pkt.remove();
        sendBtn.disabled = false;
    }
}

// 🛠️ Utility Functions
function addLog(text, type) {
    const div = document.createElement('div');
    div.className = `entry ${type}`;
    div.innerText = `> ${text}`;
    logEl.prepend(div);
}

async function logEvent(event, message) {
    if (!sb || !user) return;
    try {
        await sb.from('mission_logs').insert([{ 
            user_id: user.id, 
            event, 
            message, 
            codename 
        }]);
    } catch (e) {
        console.error("Log event failed:", e);
    }
}

async function updateLeaderboard() {
    if (!sb || !user) return;
    
    try {
        // Fetch current missions completed to avoid reset
        const { data: currentLB } = await sb.from('leaderboards').select('missions_completed').eq('id', user.id).maybeSingle();
        let completedCount = currentLB ? currentLB.missions_completed : 0;
        
        // Increment only if mission was just completed
        if (currentMission && missionProgress >= currentMission.target && !missionCompletedToday) {
            completedCount++;
            missionCompletedToday = true;
            // Mark as completed in user_mission_progress
            await sb.from('user_mission_progress').update({ completed: true }).eq('user_id', user.id).eq('mission_id', currentMission.id);
        }

        await sb.from('leaderboards').upsert({ 
            id: user.id, 
            codename, 
            mars_pings: stats.marsPings,
            missions_completed: completedCount 
        }, { onConflict: 'id' });
        fetchLeaderboard();
    } catch (e) {
        console.error("Update leaderboard failed:", e);
    }
}

async function updateMissionProgress() {
    if (!currentMission || !user || missionCompletedToday) return;
    missionProgress++;
    
    try {
        await sb.from('user_mission_progress').upsert({
            user_id: user.id,
            count: missionProgress,
            mission_id: currentMission.id,
            completed: missionProgress >= currentMission.target
        }, { onConflict: 'user_id,mission_id' });

        updateMissionUI();
        if (missionProgress >= currentMission.target) {
            addLog("MISSION SUCCESS: Daily objective complete! 🎖️", "success");
        }
    } catch (e) {
        console.error("Update mission progress failed:", e);
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
    if (to === 'mars' && stats.marsPings === 1) unlockAchievement('mars_first');
    if (isStorming) unlockAchievement('storm_survivor');
}

async function unlockAchievement(key) {
    if (!sb || !user) return;
    try {
        const { data: ach } = await sb.from('achievements').select('id').eq('key', key).single();
        if (ach) {
            // Check if already unlocked to prevent duplicate inserts/updates
            const { data: existing } = await sb.from('user_achievements')
                .select('*')
                .eq('user_id', user.id)
                .eq('achievement_id', ach.id)
                .maybeSingle();
                
            if (!existing) {
                await sb.from('user_achievements').insert({ 
                    user_id: user.id, 
                    achievement_id: ach.id 
                });
                fetchAchievements();
            }
        }
    } catch (e) {
        console.error("Unlock achievement failed:", e);
    }
}

// ⛈️ Solar Storm Management
setInterval(() => {
    if (Math.random() < 0.05 && !isStorming) {
        isStorming = true;
        document.getElementById('storm-warning').classList.remove('hidden');
        addLog("CRITICAL: Solar radiation spike detected!", "error");
        setTimeout(() => {
            isStorming = false;
            document.getElementById('storm-warning').classList.add('hidden');
            addLog("Radiation levels normalizing.", "sys");
            stats.stormsSurvived++;
        }, 8000);
    }
}, 30000);

init();
