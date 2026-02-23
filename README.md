# VoidRelay

A retro-styled space communication simulator where you relay signals between planets while dealing with solar storms, interference, and the cold reality of deep space physics.

## What It Does

VoidRelay simulates the challenges of maintaining communication across interplanetary distances. You send data packets from Earth, the Moon, or Mars to other bodies in the system, but like real space missions, nothing is guaranteed. Solar storms disrupt transmissions, asteroids can destroy packets mid-flight, and timing windows matter.

The simulation tracks your successful Mars pings on a persistent leaderboard and unlocks achievements as you master different communication scenarios.

## How the Simulation Works

### Signal Launch
Pick your origin and destination, then transmit. Your signal travels in real-time across the orbital display—you can see it moving through space.

### Environmental Hazards
- **Solar Storms**: Increase packet loss significantly. Sometimes you just have to wait them out.
- **Solar Flares**: Sudden bursts that interfere with all planetary stations at once.
- **Asteroids**: Random debris that can destroy your signal if it crosses paths.
- **Planet States**: Each planet cycles between nominal, interference, and blackout conditions.

### Capture Mechanics
Signals auto-lock when they get within **80% of a planet's radius**—think of it as a magnetic capture zone. If your signal misses this zone, it's gone. The simulation uses real collision detection, so you can watch packets snap into orbit when they succeed or drift past when they miss.

### Success / Failure Logic
Every transmission either succeeds or fails for a specific reason:
- ✓ **Success**: Signal captured, data received
- ✗ **Asteroid Collision**: Debris hit during flight
- ✗ **Trajectory Miss**: Flew past the capture zone
- ✗ **Solar Blackout**: Target planet was in blackout (unless you used EMERGENCY mode)
- ✗ **Radiation Interference**: Environmental noise corrupted the signal
- ✗ **Signal Decay**: General packet loss from distance/interference

There's a **BOOST** strategy that reduces loss by 15%, and an **EMERGENCY** mode that can punch through blackouts (but you only get 2 tokens per session, and they don't recharge).

## Tech Stack

- **Vanilla JavaScript** — No frameworks. Direct DOM manipulation.
- **Supabase** — Handles auth, leaderboard persistence, achievement tracking, and mission logs.
- **CSS** — Custom retro styling with CRT effects and two themes (space / neon).

No build step. Just open `index.html` in a browser and it runs.

## Why I Built This

I wanted to make something that felt like those old NASA mission control simulations—where you're not just clicking buttons, but actually managing real constraints. Space communication is genuinely hard. Light-speed travel time, orbital mechanics, environmental interference—these aren't just flavor, they're real problems engineers deal with.

Also, I was tired of seeing "multiplayer real-time" projects that don't actually work when you refresh the page. This one does. Leaderboard persists. Achievements load correctly when you switch accounts. Signals resolve exactly once (no duplicate events). That's the point of the stabilization pass.

## Running Locally

1. Clone the repo:
   ```bash
   git clone https://github.com/Nub-programmer/VoidRelay.git
   cd VoidRelay
   ```

2. Open `index.html` in your browser.
   ```bash
   open index.html  # macOS
   xdg-open index.html  # Linux
   start index.html  # Windows
   ```

That's it. No install, no dependencies, no npm modules.

If you want to fork it and use your own Supabase instance, replace the credentials in `index.html`:
```javascript
window.VOID_SB_URL = "your-project-url";
window.VOID_SB_KEY = "your-anon-key";
```

## Notes

The leaderboard and achievements use Supabase for persistence. If you don't have auth'ed, you get guest mode—you can still play, but your progress doesn't save.

Authentication is done with a fake email pattern (`username@voidrelay.local`) because this is a simulation, not a real service. Don't put real credentials in it.

The physics are simplified (obviously—real orbital mechanics would make this unplayable), but the core problems are real: **latency, loss, timing windows, and environmental unpredictability.**

---

Built by **Atharv (Nubprogrammer)** for the **Axoninnova Community**.

If something breaks, file an issue. If you improve it, send a PR. That's how this works.
