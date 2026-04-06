import fs from 'fs';
import path from 'path';
import os from 'os';

const SKILLS_DIR = path.join(os.homedir(), '.agent-skills');

if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

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
        } catch (e) {
            // Ignore parse errors silently in MCP
        }
    }
});

function send(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleMessage(msg) {
    if (msg.method === 'initialize') {
        let skillsText = "You have an autonomous closed-loop skills engine enabled. The following procedural memory skills are currently loaded from your ~/.agent-skills/ library. Remember to use them!\n\n";
        try {
            if (fs.existsSync(SKILLS_DIR)) {
                const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
                files.forEach(f => {
                    skillsText += `--- Skill: ${f} ---\n`;
                    skillsText += fs.readFileSync(path.join(SKILLS_DIR, f), 'utf8') + '\n\n';
                });
            }
        } catch (e) {
            skillsText += "Failed to load skills from disk.\n";
        }

        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "agent-skills-server", version: "1.0.0" },
                instructions: skillsText
            }
        });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
    } else if (msg.method === 'tools/list') {
        send({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
                tools: [{
                    name: "skill_manage",
                    description: "Manage procedural memory skills (create, edit, delete). Agent automatically uses this when discovering successful workflows to permanently save instructions.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: ["create", "edit", "delete"] },
                            name: { type: "string", description: "Skill name (e.g. gdal-converter, express-deploy)" },
                            content: { type: "string", description: "SKILL.md markdown text containing trigger conditions, numbered steps, and pitfalls." }
                        },
                        required: ["action", "name"]
                    }
                }]
            }
        });
    } else if (msg.method === 'tools/call') {
        try {
            if (msg.params.name === 'skill_manage') {
                const { action, name, content } = msg.params.arguments;
                const skillFile = path.join(SKILLS_DIR, `${name}.md`);
                
                if (action === 'create' || action === 'edit') {
                    if (!content) throw new Error("Content is required for creating/editing.");
                    fs.writeFileSync(skillFile, content, 'utf8');
                    send({
                        jsonrpc: "2.0",
                        id: msg.id,
                        result: { content: [{ type: "text", text: `Skill '${name}.md' successfully saved at ${skillFile}. The agent will load this skill on future boot.` }] }
                    });
                } else if (action === 'delete') {
                    if (fs.existsSync(skillFile)) {
                        fs.unlinkSync(skillFile);
                        send({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: { content: [{ type: "text", text: `Skill '${name}.md' successfully deleted.` }] }
                        });
                    } else {
                        throw new Error("Skill not found.");
                    }
                } else {
                    throw new Error("Invalid action.");
                }
            } else {
                throw new Error("Unknown tool.");
            }
        } catch (err) {
            send({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                    content: [{ type: "text", text: `Error: ${err.message}` }],
                    isError: true
                }
            });
        }
    }
}
