# 🔐 SecureNet Fetcher — SSRF via DNS Rebinding CTF Challenge

> **Category:** Web Exploitation  
> **Difficulty:** Hard  
> **Flag Format:** `SECE{...}`  
> **Author:** SECE CTF Team  

---

## 🎯 Challenge Description

The **SecureNet Fetcher** is a corporate internal URL-fetching service with *enterprise-grade* SSRF protection. It claims to be impenetrable — blocking every known internal IP range using pre-DNS and post-DNS validation.

An internal vault is running at `http://localhost:8080/flag` inside the container, accessible only from the server itself. Your goal: **retrieve the flag from the internal vault** through the URL fetcher.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Container                      │
│                                                         │
│  ┌─────────────────────┐     ┌──────────────────────┐  │
│  │  Main App (port 3000)│     │ Internal Vault       │  │
│  │  (public-facing)    │────▷│ (127.0.0.1:8080)     │  │
│  │                     │     │ Serves the FLAG 🚩    │  │
│  │  SSRF Filter:       │     │                      │  │
│  │  • Pre-DNS keyword  │     │ NOT accessible from  │  │
│  │  • DNS resolve+check│     │ outside container!   │  │
│  │  • Encoded IP block │     └──────────────────────┘  │
│  └─────────────────────┘                                │
└─────────────────────────────────────────────────────────┘
                    ↑
           Players connect here
           (port 3000)
```

---

## 🛡️ SSRF Protections Implemented

The filter runs **two validation phases** before making any HTTP request:

### Phase 1 — Pre-DNS Validation
- Blocks direct IP addresses (IPv4 and IPv6)
- Blocks hex/octal/decimal encoded IPs (`0x7f000001`, `2130706433`, `0177.0.0.1`)
- Keyword filter: `localhost`, `internal`, `local`, `127.`, `::1`, `0.0.0.0`, etc.
- Blocks non-HTTP schemes: `file://`, `gopher://`, `dict://`, `ftp://`
- Blocks URLs with `@` (redirect tricks)
- Blocks `nip.io`, `xip.io`, `sslip.io`, `lvh.me`, `localtest.me` wildcards

### Phase 2 — DNS Resolution Check
- Resolves the domain via `dns.lookup()`
- Checks ALL returned IPs against blocked CIDR ranges:
  - `127.0.0.0/8` — Loopback
  - `10.0.0.0/8` — Private Class A
  - `172.16.0.0/12` — Private Class B
  - `192.168.0.0/16` — Private Class C
  - `169.254.0.0/16` — Link-local (APIPA)
  - `100.64.0.0/10` — CGNAT
  - `0.0.0.0/8` — Unspecified
  - `224.0.0.0/4` — Multicast
  - `240.0.0.0/4` — Reserved
  - IPv6: `::1`, `fe80::`, `fc00::`, `::ffff:`, `ff00::`, etc.

---

## 🔓 Intended Solution — DNS Rebinding

The vulnerability lies in the **TOCTOU (Time-of-Check vs Time-of-Use)** gap between DNS validation and the actual HTTP connection.

### Attack Flow

```
Time │ Event
─────┼────────────────────────────────────────────────────────
T+0  │ Player submits: http://attacker.com:8080/flag
T+1  │ Server: Pre-DNS keyword check → PASS ✅
T+2  │ Server: dns.lookup("attacker.com") → 203.0.113.1 (public) → PASS ✅  
T+3  │ Server: Makes HTTP request to "attacker.com"
T+3  │        Node's http module re-resolves "attacker.com" via DNS
T+3  │        THIS TIME → DNS returns 127.0.0.1 (TTL=0, rebind!)
T+3  │        TCP connection opens to 127.0.0.1:8080 → INTERNAL VAULT!
T+4  │ Server: Returns flag 🏴
```

### Tools for DNS Rebinding

**Option 1: rbndr.us (easiest)**
```
http://01010101.7f000001.rbndr.us:8080/flag
```
- `01010101` = `1.1.1.1` in hex (public IP for validation)
- `7f000001` = `127.0.0.1` in hex (internal target)
- Alternates between both IPs per query with TTL=0
- May need multiple attempts (probabilistic timing)

**Option 2: singularity (most reliable)**
```bash
git clone https://github.com/nccgroup/singularity
# Configure singularity to rebind to 127.0.0.1
# Run: http://your-singularity-server/manager?rebindTo=127.0.0.1&targetPort=8080
```

**Option 3: Custom DNS server with dnspython**
```python
# See solve.py for automated exploit
python3 solve.py
```

---

## 🚀 Running the Challenge

### Local Development (no Docker)
```bash
# Terminal 1: Start internal flag vault
cd internal && npm install && node server.js

# Terminal 2: Start main challenge app
cd app && npm install && node server.js

# Visit http://localhost:3000
```

### Docker (recommended for deployment)
```bash
# Copy internal server into app context first
cp -r internal/ app/internal/

# Build and run
docker-compose up --build

# Visit http://localhost:3000
```

---

## 📋 Files

```
SSRF/
├── docker-compose.yml          # Docker deployment
├── solve.py                    # Author's solve script (DNS rebinding)
├── README.md                   # This file
├── app/
│   ├── Dockerfile
│   ├── start.sh                # Starts both services
│   ├── server.js               # 🔥 Vulnerable URL fetcher with SSRF filter
│   ├── package.json
│   └── public/
│       ├── index.html          # Cyberpunk CTF UI
│       ├── style.css
│       └── script.js
└── internal/
    ├── server.js               # 🚩 Flag vault (127.0.0.1:8080 only)
    └── package.json
```

---

## 💡 Learning Objectives

1. **Understand DNS Rebinding**: A technique that exploits the TOCTOU gap between DNS validation and actual connection
2. **SSRF Bypasses**: Why IP-based filtering alone isn't sufficient
3. **Defense**: Use `--network-plugin=calico`, separate namespaces, or validate the *socket-level* IP after connection (not just DNS)

---

## 🏁 Flag

```
SECE{d0nt_trust_the_dns_r3binding_c4n_byp4ss_y0ur_1p_f1lt3rs_42}
```
