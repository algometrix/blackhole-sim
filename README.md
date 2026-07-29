# blackhole-sim

[![CI](https://github.com/algometrix/blackhole-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/algometrix/blackhole-sim/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=three.js&logoColor=white)](https://threejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-36%20passing-brightgreen)](src/sim/__tests__)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive black hole visualizer that ray-traces **real Schwarzschild photon geodesics on the GPU**, per pixel, every frame. It renders the event horizon shadow, the photon ring, a Doppler-beamed accretion disc bent over and under the hole (the *Interstellar* look), and a gravitationally lensed starfield. You can launch photons and watch their true paths, drop a planet or star and watch it be tidally shredded, and place a second black hole to watch a gravitational-wave inspiral end in a merger, complete with a LIGO-style audio chirp.

Everything runs in the browser. No backend, no assets, no libraries beyond Three.js: the stars, disc, physics, and sound are all procedural.

## Features

- **Real GR light bending**: each pixel integrates the Schwarzschild null-geodesic equation with RK4 and adaptive stepping. The shadow, photon ring, Einstein-ring star smearing, and the disc's secondary images emerge from the math, not from textures.
- **Accretion disc**: Shakura–Sunyaev temperature profile, differential-rotation noise that shears into trailing spirals, relativistic Doppler + gravitational redshift using the bent photon direction (correct even for the lensed secondary image).
- **Interactive photon trajectories**: click to launch fans of photons; escaped, captured, and near-critical rays are drawn as glowing curves computed by the same integrator the shader uses.
- **Tidal disruption**: place a planet or star. *Cinematic* mode gives a directable inward spiral with spaghettification and a debris stream that feeds and brightens the disc. *Realistic TDE* mode launches a true zero-energy parabolic plunge, one violent shredding at pericenter, and a physically motivated bound/unbound debris split (roughly half the debris escapes, as in real TDEs).
- **Black hole merger**: place a second hole. Its orbit decays by the actual Peters (1964) gravitational-wave equations (the trajectory shape is exact; only wall-clock time is compressed). Both holes lens light. At contact the shadow swells to the merged mass minus the radiated gravitational-wave energy, with a ringdown wobble.
- **Camera flights**: plunge into the horizon, fly past, or circle the hole.
- **Procedural audio**: a Perseus-cluster-style deep drone, matter-rush noise when the disc is feeding, a gravitational-wave chirp that tracks the real orbital frequency, and a merger thump + ringdown tone whose pitch falls with the merged mass.
- **Performance**: quality presets, half-resolution raymarch upscaling, temporal accumulation when idle (free anti-aliasing), auto-degrade on slow machines.

## Setup guide (from zero)

You need two things: **Node.js** (version 20 or newer) and this repository. That's it. No accounts, no API keys, no GPU drivers to install. Follow the section for your operating system.

### Windows

1. **Open a terminal**: press the Windows key, type `powershell`, press Enter.
2. **Install Node.js** (pick one):
   - Easiest: download the **LTS** installer from <https://nodejs.org>, run it, click Next through the defaults (keep "Add to PATH" checked).
   - Or with winget, in PowerShell: `winget install OpenJS.NodeJS.LTS`
3. **Close and reopen PowerShell** (so it picks up the new PATH), then verify:
   ```powershell
   node --version
   ```
   You should see something like `v22.x.x`. Any number 20 or higher is fine.
4. **Get the code** (pick one):
   - With git: `git clone https://github.com/algometrix/blackhole-sim.git` then `cd blackhole-sim`
   - No git: on this GitHub page click the green **Code** button → **Download ZIP**, right-click the ZIP → Extract All. Open the extracted folder in Explorer, click the address bar, type `powershell`, press Enter.
5. **Install and run**:
   ```powershell
   npm install
   npm run dev
   ```
6. Open the address it prints (normally `http://localhost:5173/`) in Chrome or Edge. You should see a black hole with a glowing disc. To stop: press `Ctrl+C` in the terminal.

### macOS

1. **Open a terminal**: press `Cmd+Space`, type `terminal`, press Enter.
2. **Install Node.js** (pick one):
   - Easiest: download the **LTS** installer from <https://nodejs.org> and run it.
   - Or with Homebrew: `brew install node`
3. **Verify** (reopen the terminal if you just installed):
   ```bash
   node --version
   ```
   Any version 20 or higher is fine.
4. **Get the code** (pick one):
   - With git (already on every Mac): `git clone https://github.com/algometrix/blackhole-sim.git && cd blackhole-sim`
   - No git: green **Code** button on this page → **Download ZIP** → double-click to unzip → in Terminal type `cd ` (with a trailing space), drag the unzipped folder onto the Terminal window, press Enter.
5. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
6. Open the printed address (normally `http://localhost:5173/`) in Safari or Chrome. To stop: `Ctrl+C`.

### Linux

1. **Open your terminal.**
2. **Install Node.js 20+**:
   - Debian / Ubuntu / Mint: `sudo apt update && sudo apt install -y nodejs npm` — then check `node --version`; if it prints something below 20, install via nvm instead (next line).
   - Any distro, always current (nvm): `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`, reopen the terminal, then `nvm install --lts`
   - Fedora: `sudo dnf install -y nodejs npm` · Arch: `sudo pacman -S nodejs npm`
3. **Verify**: `node --version` → 20 or higher.
4. **Get the code**:
   ```bash
   git clone https://github.com/algometrix/blackhole-sim.git
   cd blackhole-sim
   ```
   (No git? `sudo apt install git`, or download the ZIP from the green **Code** button and `unzip` it.)
5. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
6. Open the printed address (normally `http://localhost:5173/`) in Chrome or Firefox. To stop: `Ctrl+C`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `node: command not found` | Node.js isn't installed (or the terminal was open before installing; close and reopen it). Redo step 1. |
| `npm install` fails with engine/version errors | Your Node is too old. Install the LTS from nodejs.org and reopen the terminal. |
| Blank page saying WebGL2 is required | Your browser or GPU driver blocks WebGL2. Try Chrome, and check `chrome://gpu`. |
| Port 5173 already in use | Run `npm run dev -- --port 5200` and open that port instead. |
| It runs but is choppy | Set **Render → Quality** to `low` in the control panel; the app also auto-lowers quality after a few slow seconds. |

### Other commands

```bash
npm test           # run the 36-test physics/simulation suite
npm run typecheck  # strict TypeScript check
npm run build      # production build into dist/
npm run preview    # serve the production build
```

## How to use it

| Action | How |
|---|---|
| Orbit / zoom | drag / scroll |
| Place a planet or star | **Place** folder → button → click on the disc plane (between the guide rings) |
| Choose disruption physics | **Place → Disruption mode**: cinematic spiral vs realistic one-pass TDE |
| Place a second black hole | **Place → Place black hole** → click; watch the inspiral chirp in the HUD |
| Speed up / slow the inspiral | **Simulation → GW time ×** |
| Launch photons | **Light paths → Enabled**, then click anywhere; rays per launch and spread are sliders |
| Camera flights | **Camera** folder: fly in (plunge), fly past, circle; `Esc` stops |
| Sound | **Sound → Enabled** (browsers require one click on the page first) |
| Art-direction knobs | append `?debug=1` to the URL for the hidden tuning folder |

## The physics

Geometric units throughout: $G = c = 1$, lengths in Schwarzschild radii ($r_s = 2M = 1$, so $M = \tfrac{1}{2}$). The disc lies in the equatorial plane.

### Light: null geodesics (exact)

Each pixel's ray integrates the 3D vector form of the Schwarzschild photon equation of motion,

$$\ddot{\mathbf{x}} = -\tfrac{3}{2}\, r_s\, h^2\, \frac{\mathbf{x}}{r^5}, \qquad h = |\mathbf{x} \times \dot{\mathbf{x}}| \ (\text{conserved}),$$

equivalent to the Binet form $u''(\phi) + u = \tfrac{3}{2} r_s u^2$ with $u = 1/r$, integrated with RK4 and an adaptive step $\Delta t \propto (r - 0.9\,r_s)$. Rays with impact parameter below the critical value

$$b_{\text{crit}} = 3\sqrt{3}\,M = \frac{3\sqrt{3}}{2}\,r_s \approx 2.598\,r_s$$

fall in (this sets the apparent shadow radius); the photon sphere sits at $1.5\,r_s$; the weak-field deflection limit is $\alpha \simeq 2 r_s / b$. The CPU integrator that draws the photon-path curves runs the same equation with the same constants, so the drawn paths land exactly on the features the shader renders. With two holes, the deflections of both centers are superposed (each with its own $h$), which is exact for one hole and a standard qualitative approximation for two.

### Accretion disc (standard thin-disc physics)

Temperature follows the Shakura–Sunyaev profile

$$T(r) \propto r^{-3/4}\left(1 - \sqrt{r_{\text{in}}/r}\right)^{1/4},$$

with the inner edge at the ISCO, $r_{\text{in}} = 6M = 3\,r_s$. Matter orbits at the circular-geodesic speed measured by a static observer, $\beta = \sqrt{r_s / \,2(r - r_s)}$ (0.5c at the ISCO), and every disc sample is shifted by the combined gravitational + Doppler factor

$$g = \frac{\sqrt{1 - \tfrac{3M}{r}}}{\gamma\,(1 - \beta\cos\alpha)},$$

applied to brightness as $g^3$ (relativistic beaming) and to color by shifting the blackbody temperature, using the *bent* photon direction at the crossing, so the lensed secondary image beams correctly too. Multiple equatorial-plane crossings during integration produce the image of the disc's far side bent over and under the hole.

### Massive bodies (pseudo-Newtonian)

Planets, stars, and debris move in the Paczyński–Wiita potential

$$\Phi(r) = -\frac{GM}{r - r_s},$$

the standard pseudo-Newtonian stand-in that reproduces the correct ISCO at $3\,r_s$, so bodies destabilize and plunge exactly where the disc ends. Realistic-TDE launches are zero-energy (parabolic) orbits in this potential with pericenter at a chosen fraction of the tidal radius; the debris receives an energy spread that splits it into bound and unbound halves, mirroring the real result that roughly half a disrupted star's mass escapes.

### Binary inspiral (exact trajectory, compressed clock)

The secondary's separation decays by the circular-orbit Peters equation,

$$\frac{da}{dt} = -\frac{64}{5}\,\frac{G^3\, m_1 m_2 (m_1 + m_2)}{c^5\, a^3},$$

with Keplerian phase advance $\omega = \sqrt{(m_1+m_2)/a^3}$. The chirp profile (orbits vs separation) is exact; wall-clock time is compressed by a UI-visible factor because the true geometric-time inspiral from $8\,r_s$ takes ~1600 time units. At contact the merged mass is $M_f = M_{\text{tot}} - E_{\text{rad}}$ with

$$E_{\text{rad}} \approx 0.048\, M_{\text{tot}} \cdot \frac{\eta}{0.25}, \qquad \eta = \frac{m_1 m_2}{(m_1+m_2)^2},$$

normalized to GW150914's ~4.6% at equal mass. The audio chirp frequency tracks $2\times$ the orbital frequency, as gravitational waves do.

### Honest limitations

- The full spacetime of two holes requires numerical relativity; this app superposes two Schwarzschild deflections, which is qualitatively right (double shadows, eyebrow images) but not exact in the final strong-field moments. The ringdown "breathing" of the shadow is art-directed shorthand for quasi-normal ringing.
- The cinematic disruption mode is deliberately directable (drag-driven inspiral, fixed tidal radii): physics-inspired theater, not a simulation. Realistic mode is the honest one.
- Debris particles are occluded by the horizon and approximately deflected, but not fully ray-traced.
- No black hole spin (Schwarzschild, not Kerr) and no light travel-time delay.

## Architecture

```
src/physics/   constants + CPU null-geodesic integrator (shared numbers with the shader)
src/sim/       pure simulation core: PW gravity, tidal phase machine, debris pool,
               Peters binary inspiral — zero WebGL/DOM, fully unit-tested (vitest)
src/render/    GPU side: geodesic raymarch pass, starfield cubemap baker, bloom,
               composite, horizon-mask occlusion, photon-path tubes, camera tours
src/audio/     procedural WebAudio engine (drone, disc rush, GW chirp, merger)
src/ui/        lil-gui panel + click-to-place controller
src/main.ts    fixed-timestep sim loop + per-frame GPU/audio/HUD sync
```

The renderer's key trick: everything that must be *truly* lensed (sky, disc, the stretched body, both holes) lives inside one full-screen raymarch shader; everything that is many-small-glowing-things (debris, photon paths, gizmos) renders as ordinary additive geometry occluded by the shader's horizon mask. The shader and CPU share one source of truth for the physics constants.

## References

- J.-P. Luminet, *Image of a spherical black hole with thin accretion disk*, A&A 75, 228 (1979) — the first computed image of what this app draws.
- O. James, E. von Tunzelmann, P. Franklin, K. S. Thorne, *Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar*, Class. Quantum Grav. 32, 065001 (2015).
- P. C. Peters, *Gravitational Radiation and the Motion of Two Point Masses*, Phys. Rev. 136, B1224 (1964) — the inspiral equations.
- N. I. Shakura, R. A. Sunyaev, *Black holes in binary systems. Observational appearance*, A&A 24, 337 (1973) — the disc temperature profile.
- B. Paczyński, P. J. Wiita, *Thick accretion disks and supercritical luminosities*, A&A 88, 23 (1980) — the pseudo-Newtonian potential.
- M. J. Rees, *Tidal disruption of stars by black holes of 10⁶–10⁸ solar masses in nearby galaxies*, Nature 333, 523 (1988) — the bound/unbound debris split.
- LIGO Scientific Collaboration & Virgo Collaboration, *Observation of Gravitational Waves from a Binary Black Hole Merger* (GW150914), Phys. Rev. Lett. 116, 061102 (2016) — the chirp, the radiated-mass numbers.
- NASA Chandra sonifications, *Perseus cluster black hole* (2022) — the inspiration for the drone.

## License

[MIT](LICENSE)
