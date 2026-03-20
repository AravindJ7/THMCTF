const http = require('http');

// This service only binds to localhost and is NOT accessible from outside
// The flag is only retrievable via DNS Rebinding attack
const FLAG = 'THM{d0nt_trust_the_dns_r3binding_c4n_byp4ss_y0ur_1p_f1lt3rs_42}';

const server = http.createServer((req, res) => {
    const clientIP = req.socket.remoteAddress;
    const forwardedFor = req.headers['x-forwarded-for'];

    // Log access attempts for challenge monitoring
    console.log(`[INTERNAL] Access from: ${clientIP} | Forwarded: ${forwardedFor} | Path: ${req.url}`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Internal-Service', 'true');
    res.setHeader('X-Challenge', 'SSRF-DNS-Rebinding');

    if (req.url === '/' || req.url === '/flag') {
        res.writeHead(200);
        res.end(JSON.stringify({
            service: 'Internal Secret Vault',
            classification: 'TOP SECRET',
            flag: FLAG,
            message: 'Congratulations! You successfully exploited DNS Rebinding to bypass the SSRF filter!',
            hint: 'The server resolved your domain as a public IP during the check, but switched to 127.0.0.1 by the time the actual HTTP request was made!',
            timestamp: new Date().toISOString(),
        }, null, 2));
    } else if (req.url === '/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'alive', service: 'Internal Vault' }));
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found', available: ['/', '/flag', '/ping'] }));
    }
});

const PORT = 8080;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`[*] Internal Secret Vault running on 127.0.0.1:${PORT} (localhost only)`);
    console.log(`[*] Only accessible via DNS Rebinding attack!`);
});
