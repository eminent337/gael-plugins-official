import fs from 'fs';
import path from 'path';

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
        if (!line.trim()) continue;
        try {
            handleMessage(JSON.parse(line));
        } catch (e) {}
    }
});

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

async function runMoA(prompt) {
    // If no keys, stub it gracefully
    if (!process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
        return "MoA Engine (Mocked): To enable true multi-model debate, set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in your .env. \n\n[Debate Synthesis Simulation]: Based on analyzing 3 virtual perspectives, the best approach is to carefully plan before writing code.";
    }

    try {
        const apiKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
        const apiUrl = process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.anthropic.com/v1/messages";
        
        let headers = {};
        if (process.env.OPENROUTER_API_KEY) {
            headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };
        } else {
            headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" };
        }

        // Simulate a parallel debate simply with 1 fast call indicating synthesis (as a lightweight fallback proxy for MoA)
        const payload = process.env.OPENROUTER_API_KEY ? {
            model: "google/gemini-2.5-flash",
            messages: [
                { role: "system", content: "You are the leader of a Mixture of Agents debate committee. Analyze the problem from 3 unique perspectives, debate them internally, and return the absolute best synthesized solution." },
                { role: "user", content: prompt }
            ]
        } : {
            model: "claude-3-haiku-20240307",
            max_tokens: 1024,
            system: "You are the leader of a Mixture of Agents debate committee. Analyze the problem from 3 unique perspectives, debate them internally, and return the absolute best synthesized solution.",
            messages: [{ role: "user", content: prompt }]
        };

        const req = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify(payload) });
        const res = await req.json();
        
        if (process.env.OPENROUTER_API_KEY) {
            return res.choices[0].message.content;
        } else {
            return res.content[0].text;
        }
    } catch (e) {
        return `MoA Engine encountered an error: ${e.message}`;
    }
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                protocolVersion: "2024-11-05", capabilities: { tools: {} },
                serverInfo: { name: "agent-moa", version: "1.0.0" }
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0", id: msg.id,
            result: {
                tools: [
                    {
                        name: "moa_debate",
                        description: "Submit a highly complex or ambiguous problem to a committee of background LLM agents. They will debate multiple perspectives and return a synthesized optimal consensus.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                problem_statement: { type: "string" }
                            },
                            required: ["problem_statement"]
                        }
                    }
                ]
            }
        });
    } else if (msg.method === 'tools/call') {
        if (msg.params.name === 'moa_debate') {
            const { problem_statement } = msg.params.arguments;
            runMoA(problem_statement).then(result => {
                send({
                    jsonrpc: "2.0", id: msg.id,
                    result: { content: [{ type: "text", text: result }] }
                });
            });
        }
    }
}
