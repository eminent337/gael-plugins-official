import fs from 'fs';

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

async function checkOSV(ecosystem, pkg_name, version) {
    try {
        const payload = {
            version: version,
            package: {
                name: pkg_name,
                ecosystem: ecosystem
            }
        };

        const req = await fetch("https://api.osv.dev/v1/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (!req.ok) throw new Error("OSV API unreachable.");
        const data = await req.json();

        if (data.vulns && data.vulns.length > 0) {
            let res = `[DANGER] ${data.vulns.length} vulnerabilities found in ${pkg_name}@${version}:\n`;
            data.vulns.forEach(v => {
                res += `- ${v.id}: ${v.summary || 'No summary available'}\n`;
            });
            return res;
        } else {
            return `[SAFE] No known vulnerabilities found for ${pkg_name}@${version} in OSV database.`;
        }
    } catch (e) {
        return `OSV Lookup Failed: ${e.message}`;
    }
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        const txt = `Whenever you are about to install a third-party dependency into the project (NPM, PyPI, etc), you MUST check it for security vulnerabilities first using the 'check_dependency' tool before proceeding with 'npm install' or 'pip install'.`;
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                protocolVersion: "2024-11-05", capabilities: { tools: {} },
                serverInfo: { name: "security-osv", version: "1.0.0" },
                instructions: txt
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                tools: [
                    {
                        name: "check_dependency",
                        description: "Check an open source package against the OSV (Open Source Vulnerability) database before installing.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                ecosystem: { type: "string", description: "'npm', 'PyPI', 'crates.io', 'Go', etc." },
                                package_name: { type: "string" },
                                version: { type: "string", description: "Version to install (e.g. '1.0.0')" }
                            }, required: ["ecosystem", "package_name", "version"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params;
        if (name === 'check_dependency') {
            checkOSV(args.ecosystem, args.package_name, args.version).then(res => {
                send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: res }] } });
            });
        }
    }
}
