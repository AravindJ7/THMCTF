/* ============================================================
   SECURENET FETCHER — JavaScript
   ============================================================ */

// ── Clock ────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const el = document.getElementById('clock');
    if (el) el.textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// Set init time in log
const initEl = document.getElementById('initTime');
if (initEl) {
    const now = new Date();
    initEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

// ── Particle Canvas ──────────────────────────────────────────
(function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() { this.reset(true); }
        reset(init = false) {
            this.x = Math.random() * W;
            this.y = init ? Math.random() * H : H + 10;
            this.vx = (Math.random() - 0.5) * 0.3;
            this.vy = -(Math.random() * 0.4 + 0.1);
            this.size = Math.random() * 2 + 0.5;
            this.alpha = Math.random() * 0.6 + 0.1;
            this.color = Math.random() > 0.5 ? '0,212,255' : '139,92,246';
            this.pulsing = Math.random() > 0.7;
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            if (this.pulsing) this.alpha = 0.1 + 0.5 * Math.abs(Math.sin(Date.now() / 1200 + this.x));
            if (this.y < -10) this.reset();
        }
        draw() {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgb(${this.color})`;
            ctx.shadowColor = `rgb(${this.color})`;
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.restore();
        }
    }

    // Also draw floating binary/hex chars
    const CHARS = '01ABCDEF<>/{}[]';
    class MatrixChar {
        constructor() { this.reset(true); }
        reset(init = false) {
            this.x = Math.random() * W;
            this.y = init ? Math.random() * H : -20;
            this.speed = Math.random() * 0.5 + 0.1;
            this.char = CHARS[Math.floor(Math.random() * CHARS.length)];
            this.alpha = Math.random() * 0.15 + 0.02;
            this.size = Math.floor(Math.random() * 6 + 9);
            this.timer = 0;
            this.interval = Math.floor(Math.random() * 80 + 40);
        }
        update() {
            this.y += this.speed;
            this.timer++;
            if (this.timer % this.interval === 0) this.char = CHARS[Math.floor(Math.random() * CHARS.length)];
            if (this.y > H + 20) this.reset();
        }
        draw() {
            ctx.save();
            ctx.globalAlpha = this.alpha;
            ctx.font = `${this.size}px 'Share Tech Mono', monospace`;
            ctx.fillStyle = '#00d4ff';
            ctx.fillText(this.char, this.x, this.y);
            ctx.restore();
        }
    }

    for (let i = 0; i < 80; i++) particles.push(new Particle());
    const matrixChars = [];
    for (let i = 0; i < 40; i++) matrixChars.push(new MatrixChar());

    function animate() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => { p.update(); p.draw(); });
        matrixChars.forEach(c => { c.update(); c.draw(); });
        requestAnimationFrame(animate);
    }
    animate();
})();

// ── Hint Toggle ──────────────────────────────────────────────
function toggleHint() {
    const panel = document.getElementById('hintPanel');
    panel.classList.toggle('hidden');
}

// ── Clear Output ─────────────────────────────────────────────
function clearOutput() {
    const out = document.getElementById('outputArea');
    out.innerHTML = `
    <div class="output-placeholder">
      <div class="placeholder-icon">_</div>
      <p>Awaiting command...</p>
    </div>`;
}

function clearLog() {
    const log = document.getElementById('securityLog');
    log.innerHTML = '';
    addLog('LOG CLEARED', 'info');
}

// ── Security Log ─────────────────────────────────────────────
function addLog(msg, level = 'info') {
    const log = document.getElementById('securityLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${level}`;
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    entry.innerHTML = `
    <span class="log-time">${ts}</span>
    <span class="log-level ${level}">${level.toUpperCase()}</span>
    <span class="log-msg">${msg}</span>`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// ── Filter Card Trigger ──────────────────────────────────────
function triggerFilterCard(id) {
    const card = document.getElementById(id);
    if (!card) return;
    const status = card.querySelector('.filter-status');
    if (!status) return;
    status.classList.remove('active');
    status.classList.add('triggered');
    status.textContent = 'BLOCKED!';
    setTimeout(() => {
        status.classList.remove('triggered');
        status.classList.add('active');
        status.textContent = 'ACTIVE';
    }, 3000);
}

// ── Progress Animation ───────────────────────────────────────
async function runProgress(stages) {
    const container = document.getElementById('progressContainer');
    const bar = document.getElementById('progressBar');
    const label = document.getElementById('progressLabel');
    container.style.display = 'block';
    bar.style.width = '0%';

    for (let i = 0; i < stages.length; i++) {
        const { pct, text, ms } = stages[i];
        label.textContent = text;
        bar.style.width = pct + '%';
        await new Promise(r => setTimeout(r, ms));
    }

    setTimeout(() => { container.style.display = 'none'; }, 800);
}

// ── URL Validation (client-side preview) ─────────────────────
function quickClientCheck(url) {
    const lc = url.toLowerCase();
    const blocked = ['localhost', '127.', '0.0.0.0', '::1', '169.254', '10.', '172.', '192.168', 'internal', 'local', '@', 'file:', 'gopher:', 'dict:', 'ftp:'];
    for (const b of blocked) {
        if (lc.includes(b)) return `Client pre-check: URL contains blocked pattern "${b}"`;
    }
    return null;
}

// ── Main Fetch Function ──────────────────────────────────────
async function fetchURL() {
    const input = document.getElementById('urlInput');
    const btn = document.getElementById('fetchBtn');
    const out = document.getElementById('outputArea');
    const url = input.value.trim();

    if (!url) {
        addLog('Empty URL submitted', 'warn');
        out.innerHTML = `<div class="output-error">⚠ Please enter a URL to fetch.</div>`;
        return;
    }

    // Client-side check for terminal feedback
    const clientErr = quickClientCheck(url);
    if (clientErr) {
        addLog(`SSRF attempt detected (client): ${url}`, 'danger');
        triggerFilterCard('fc-keyword');
        out.innerHTML = `<div class="output-error">🛡️ Client-side pre-filter: ${clientErr}</div>`;
        return;
    }

    btn.disabled = true;
    addLog(`Fetch initiated: ${url}`, 'info');

    await runProgress([
        { pct: 15, text: 'INITIALIZING REQUEST...', ms: 300 },
        { pct: 35, text: 'PRE-DNS VALIDATION...', ms: 400 },
        { pct: 55, text: 'RESOLVING DNS...', ms: 600 },
        { pct: 70, text: 'VALIDATING RESOLVED IPs...', ms: 400 },
        { pct: 85, text: 'CONNECTING TO TARGET...', ms: 500 },
        { pct: 100, text: 'PROCESSING RESPONSE...', ms: 300 },
    ]);

    try {
        const resp = await fetch('/api/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        const data = await resp.json();

        if (data.success) {
            const bodyText = data.body || '(empty response)';
            const hasFlag = bodyText.includes('THM{');

            addLog(`Fetch SUCCESS — HTTP ${data.status} from ${url}`, 'success');

            let flagHtml = '';
            if (hasFlag) {
                const flagMatch = bodyText.match(/THM\{[^}]+\}/);
                if (flagMatch) {
                    flagHtml = `<div class="output-flag">🎉 FLAG CAPTURED: ${flagMatch[0]}</div>`;
                    addLog(`🏆 FLAG CAPTURED! ${flagMatch[0]}`, 'success');
                    launchFlagCelebration();
                }
            }

            out.innerHTML = `
        <div class="output-info">✅ FETCH SUCCESSFUL</div>
        <div class="output-meta">URL: ${escHtml(url)} | Status: ${data.status} | Time: ${data.resolvedAt}</div>
        <div class="output-body">${escHtml(bodyText)}</div>
        ${flagHtml}
      `;
        } else {
            // Map stage to filter card
            const stageMap = {
                'pre_dns_validation': ['fc-keyword', 'fc-encoded', 'fc-loopback'],
                'dns_resolution_check': ['fc-dns'],
                'http_fetch': [],
            };
            const dominated = stageMap[data.stage] || [];
            dominated.forEach(triggerFilterCard);

            const level = data.stage === 'http_fetch' ? 'warn' : 'danger';
            addLog(`SSRF BLOCKED [${data.stage}]: ${data.error}`, level);

            out.innerHTML = `
        <div class="output-error">❌ REQUEST BLOCKED</div>
        <div class="output-meta">Stage: ${data.stage || 'unknown'} | URL: ${escHtml(url)}</div>
        <div style="margin-top:14px; padding:14px; background:rgba(255,0,106,0.06); border:1px solid rgba(255,0,106,0.3); border-radius:4px; color:#ff6a9a; font-family:'Share Tech Mono',monospace; font-size:13px;">
          ${escHtml(data.error)}
        </div>
      `;
        }
    } catch (err) {
        addLog(`Fetch error: ${err.message}`, 'danger');
        out.innerHTML = `<div class="output-error">💥 Network Error: ${escHtml(err.message)}</div>`;
    } finally {
        btn.disabled = false;
    }
}

// ── Flag Celebration ─────────────────────────────────────────
function launchFlagCelebration() {
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const burst = [];
    for (let i = 0; i < 200; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 8 + 2;
        burst.push({
            x: W / 2, y: H / 2,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 4 + 1,
            alpha: 1,
            color: ['0,255,136', '0,212,255', '255,215,0', '255,0,106'][Math.floor(Math.random() * 4)],
        });
    }

    function animateBurst() {
        burst.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            p.vy += 0.15; // gravity
            p.alpha -= 0.015;
            if (p.alpha > 0) {
                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgb(${p.color})`;
                ctx.shadowColor = `rgb(${p.color})`;
                ctx.shadowBlur = 8;
                ctx.fill();
                ctx.restore();
            }
        });
        if (burst.some(p => p.alpha > 0)) requestAnimationFrame(animateBurst);
    }
    animateBurst();
}

// ── Escape HTML ──────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Enter key submit ─────────────────────────────────────────
document.getElementById('urlInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') fetchURL();
});

// ── Sample URLs tooltip ──────────────────────────────────────
const sampleUrls = [
    'http://127.0.0.1:8080/flag',
    'http://localhost:8080/',
    'http://0177.0.0.1:8080/',
    'http://2130706433:8080/',
    'http://::1:8080/',
];
let sampleIdx = 0;
document.getElementById('urlInput').addEventListener('focus', function () {
    if (!this.value) {
        this.placeholder = sampleUrls[sampleIdx % sampleUrls.length];
        sampleIdx++;
    }
});

// ── Typing animation for status bar ─────────────────────────
const statusMessages = [
    '⚠ CLASSIFIED SYSTEM ⚠',
    '⚠ UNAUTHORIZED ACCESS MONITORED ⚠',
    '⚠ SSRF PROTECTION ACTIVE ⚠',
    '⚠ ALL ATTEMPTS LOGGED ⚠',
];
let msgIdx = 0;
setInterval(() => {
    msgIdx = (msgIdx + 1) % statusMessages.length;
    const el = document.querySelector('.blink-text');
    if (el) el.textContent = statusMessages[msgIdx];
}, 4000);
