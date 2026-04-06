import fs from 'fs';
import https from 'https';

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
        if (!line.trim()) continue;
        try { handleMessage(JSON.parse(line)); } catch (e) {}
    }
});

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

async function scrapeStealth(url) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Sec-Ch-Ua': 'Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    resolve(`Stealth Scraper: Redirected to ${res.headers.location}. (Use stealth_scrape on the new URL)`);
                } else if (res.statusCode === 403 || res.statusCode === 503) {
                    resolve(`Stealth Scraper: Blocked by WAF/Cloudflare (Status ${res.statusCode}). To fully bypass, you must configure a Camofox path in .env.`);
                } else {
                    resolve(`Stealth Scrape Result (Status ${res.statusCode}):\n\n${data.substring(0, 10000)}... [Truncated for memory]`);
                }
            });
        });
        
        req.on('error', e => {
            resolve(`Stealth Scraper Error: ${e.message}`);
        });
    });
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                protocolVersion: "2024-11-05", capabilities: { tools: {} },
                serverInfo: { name: "browser-camofox", version: "1.0.0" }
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                tools: [
                    {
                        name: "stealth_scrape",
                        description: "Scrape a website using stealth headers. Good for bypassing Cloudflare/WAF blocks on documentation sites when native WebSearchTool fails.",
                        inputSchema: {
                            type: "object",
                            properties: { url: { type: "string" } },
                            required: ["url"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        if (name === 'stealth_scrape') {
            scrapeStealth(args.url).then(res => {
                send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: res }] } });
            });
        }
    }
}
