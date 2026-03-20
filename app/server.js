const express = require('express');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// SSRF PROTECTION: Block all internal/private IP addresses
// This is "unbypassable" using direct IP - only DNS rebinding works!
// ============================================================

const BLOCKED_CIDRS = [
    // Loopback
    { start: ip2long('127.0.0.0'), end: ip2long('127.255.255.255') },
    // Private Class A
    { start: ip2long('10.0.0.0'), end: ip2long('10.255.255.255') },
    // Private Class B
    { start: ip2long('172.16.0.0'), end: ip2long('172.31.255.255') },
    // Private Class C
    { start: ip2long('192.168.0.0'), end: ip2long('192.168.255.255') },
    // Link-local
    { start: ip2long('169.254.0.0'), end: ip2long('169.254.255.255') },
    // CGNAT
    { start: ip2long('100.64.0.0'), end: ip2long('100.127.255.255') },
    // Documentation ranges (RFC 5737)
    { start: ip2long('192.0.2.0'), end: ip2long('192.0.2.255') },
    { start: ip2long('198.51.100.0'), end: ip2long('198.51.100.255') },
    { start: ip2long('203.0.113.0'), end: ip2long('203.0.113.255') },
    // Multicast
    { start: ip2long('224.0.0.0'), end: ip2long('239.255.255.255') },
    // Reserved/Broadcast
    { start: ip2long('240.0.0.0'), end: ip2long('255.255.255.255') },
    // Unspecified
    { start: ip2long('0.0.0.0'), end: ip2long('0.255.255.255') },
];

// Blocked IPv6 ranges / addresses
const BLOCKED_IPV6 = [
    '::1',           // Loopback
    '::',            // Unspecified
    'fe80',          // Link-local prefix
    'fc00',          // ULA prefix
    'fd00',          // ULA prefix
    '::ffff:',       // IPv4-mapped
    '2001:db8',      // Documentation
    'ff00',          // Multicast
];

// Blocked hostnames / keywords
const BLOCKED_KEYWORDS = [
    'localhost',
    'internal',
    'intranet',
    'local',
    '0.0.0.0',
    'metadata',        // Cloud metadata services
    '169.254',
    'burpcollaborator',
    '127.',
    '::1',
    '[::1]',
    '[::',
    'xip.io',
    'nip.io',
    'sslip.io',
    'localtest.me',
    'lvh.me',
    '0177.',           // Octal
];

// Blocked schemes
const ALLOWED_SCHEMES = ['http:', 'https:'];

function ip2long(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function isPrivateIP(ip) {
    // IPv6 check
    if (ip.includes(':')) {
        const lower = ip.toLowerCase();
        return BLOCKED_IPV6.some(prefix => lower.startsWith(prefix) || lower === prefix);
    }
    // IPv4 check
    try {
        const long = ip2long(ip);
        return BLOCKED_CIDRS.some(range => long >= range.start && long <= range.end);
    } catch {
        return true; // Block on parse error
    }
}

function containsBlockedKeyword(str) {
    const lower = str.toLowerCase();
    return BLOCKED_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// Validate & sanitize URL before resolving
function validateUrlPreDNS(urlStr) {
    let parsed;
    try {
        parsed = new URL(urlStr);
    } catch {
        return { allowed: false, reason: 'Invalid URL format' };
    }

    // Check scheme
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
        return { allowed: false, reason: `Protocol "${parsed.protocol}" is not allowed. Only HTTP/HTTPS.` };
    }

    // Check for non-standard port tricks (e.g. port 8080 on external host is fine, but flag it in logs)
    const port = parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    if (port < 1 || port > 65535) {
        return { allowed: false, reason: 'Invalid port number.' };
    }

    // Hostname keyword check
    const hostname = parsed.hostname;
    if (containsBlockedKeyword(hostname)) {
        return { allowed: false, reason: `Hostname "${hostname}" contains a blocked keyword.` };
    }
    if (containsBlockedKeyword(urlStr)) {
        return { allowed: false, reason: 'URL contains blocked keywords.' };
    }

    // Block direct IP notation (must use a domain name)
    // This prevents 127.0.0.1, 0x7f000001, 0177.0.0.1 etc.
    if (net.isIP(hostname)) {
        const ip = hostname;
        if (isPrivateIP(ip)) {
            return { allowed: false, reason: `Direct internal IP address "${ip}" is blocked.` };
        }
        // Even public IPs via direct notation - we'll still DNS-resolve (no-op) and re-check
    }

    // Block decimal/octal/hex encoded IPs
    const decimalIpRegex = /^(0x[0-9a-fA-F]+|\d+)$/;
    if (decimalIpRegex.test(hostname)) {
        return { allowed: false, reason: 'Encoded IP address format is blocked.' };
    }

    // Block @ in URL (redirect tricks)
    if (urlStr.includes('@')) {
        return { allowed: false, reason: 'URLs with "@" are not allowed.' };
    }

    return { allowed: true, parsed, hostname, port };
}

// DNS resolution + IP validation (called ONCE, before fetch)
async function resolveAndValidate(hostname) {
    return new Promise((resolve) => {
        dns.lookup(hostname, { all: true }, (err, addresses) => {
            if (err || !addresses || addresses.length === 0) {
                return resolve({ allowed: false, reason: `DNS resolution failed for "${hostname}"` });
            }
            for (const { address } of addresses) {
                if (isPrivateIP(address)) {
                    return resolve({
                        allowed: false,
                        reason: `Resolved IP "${address}" for host "${hostname}" is in a private/reserved range.`
                    });
                }
            }
            resolve({ allowed: true, addresses });
        });
    });
}

// Deliberate delay helper — widens the DNS rebinding race window
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Safe fetch with timeout - NOTE: This is where DNS rebinding works!
// The DNS check above passes (public IP at check time),
// but by the time the actual HTTP connection is made,
// the DNS TTL has expired and the attacker's server now returns 127.0.0.1
function safeFetch(urlStr, parsed, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const mod = parsed.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsed.hostname, // Uses DNS again here! <-- DNS rebinding point
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'InternalFetcher/1.0',
                'Accept': 'text/html,text/plain,application/json',
            },
            timeout: timeoutMs,
        };

        const req = mod.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data.substring(0, 4096), // Limit response size
                });
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

// ============================================================
// API ENDPOINT: /api/fetch
// ============================================================
app.post('/api/fetch', async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, error: 'URL is required.' });
    }

    if (url.length > 2048) {
        return res.status(400).json({ success: false, error: 'URL too long.' });
    }

    // Step 1: Pre-DNS validation
    const preCheck = validateUrlPreDNS(url);
    if (!preCheck.allowed) {
        return res.status(403).json({
            success: false,
            error: `🛡️ SSRF Protection Triggered: ${preCheck.reason}`,
            stage: 'pre_dns_validation'
        });
    }

    // Step 2: Resolve DNS and validate resolved IPs
    const dnsCheck = await resolveAndValidate(preCheck.hostname);
    if (!dnsCheck.allowed) {
        return res.status(403).json({
            success: false,
            error: `🛡️ SSRF Protection Triggered: ${dnsCheck.reason}`,
            stage: 'dns_resolution_check'
        });
    }

    // ✅ DNS check passed — log resolved IPs
    const resolvedIPs = dnsCheck.addresses.map(a => a.address).join(', ');
    console.log(`[DNS OK] Host "${preCheck.hostname}" resolved to [${resolvedIPs}] — all public. Proceeding to fetch in 3s...`);

    // ⏳ Intentional 3-second window before the HTTP connection is made.
    // During this gap the DNS TTL may expire, allowing a rebinding attack:
    //   → DNS check saw a PUBLIC IP  (passed ✅)
    //   → Attacker flips DNS to 127.0.0.1 within these 3 seconds
    //   → http.request() re-resolves and now connects to localhost!
    await sleep(3000);
    console.log(`[FETCH ] Now opening TCP connection to "${preCheck.hostname}" (DNS will be re-resolved by OS)...`);

    // Step 3: Fetch the URL
    // ⚠️ DNS Rebinding window: hostname is re-resolved here by Node's http module
    try {
        const result = await safeFetch(url, preCheck.parsed);
        return res.json({
            success: true,
            status: result.status,
            body: result.body,
            resolvedAt: new Date().toISOString(),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: `Fetch error: ${err.message}`,
            stage: 'http_fetch'
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Secure Fetcher Online', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[*] Secure URL Fetcher running on port ${PORT}`);
    console.log(`[*] Internal flag service available at http://localhost:8080 (blocked from external access)`);
});
