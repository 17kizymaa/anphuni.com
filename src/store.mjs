import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function withDefaults(state) {
    const next = state || {};
    if (!Array.isArray(next.projects)) {
        next.projects = [];
    }
    if (!Array.isArray(next.assets)) {
        next.assets = [];
    }
    if (!Array.isArray(next.loops)) {
        next.loops = [];
    }
    if (!Array.isArray(next.users)) {
        next.users = [];
    }
    if (!Array.isArray(next.sessions)) {
        next.sessions = [];
    }
    if (!next.counters || typeof next.counters !== "object") {
        next.counters = {};
    }
    if (typeof next.counters.project !== "number") {
        next.counters.project = next.projects.length;
    }
    if (typeof next.counters.asset !== "number") {
        next.counters.asset = next.assets.length;
    }
    if (typeof next.counters.loop !== "number") {
        next.counters.loop = next.loops.length;
    }
    if (typeof next.counters.user !== "number") {
        next.counters.user = next.users.length;
    }
    if (typeof next.counters.session !== "number") {
        next.counters.session = next.sessions.length;
    }
    return next;
}

function ensureStateFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(STATE_FILE)) {
        const initial = withDefaults({});
        fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    }
}

export function loadState() {
    ensureStateFile();
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return withDefaults(JSON.parse(raw));
}

export function saveState(state) {
    ensureStateFile();
    fs.writeFileSync(STATE_FILE, JSON.stringify(withDefaults(state), null, 2));
}

export function nextId(state, type) {
    const safeState = withDefaults(state);
    if (typeof safeState.counters[type] !== "number") {
        safeState.counters[type] = 0;
    }
    safeState.counters[type] += 1;
    return `${type}-${safeState.counters[type]}`;
}

