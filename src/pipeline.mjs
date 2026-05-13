import { loadState, saveState, nextId } from "./store.mjs";

const ALLOWED_TRANSITIONS = {
    draft: ["review"],
    review: ["approved", "rejected", "changes_requested"],
    changes_requested: ["draft"],
    approved: ["published"],
    rejected: []
};

const BACKLOG_STAGE_WEIGHT = {
    changes_requested: 1,
    review: 2,
    draft: 3,
    approved: 4,
    published: 99,
    rejected: 99
};

function assert(condition, message) {
    if (!condition) {
        const error = new Error(message);
        error.status = 400;
        throw error;
    }
}

function now() {
    return new Date().toISOString();
}

export function createProject(name, options = {}) {
    const state = loadState();
    const id = nextId(state, "project");
    const project = {
        id,
        name,
        kickoffApproved: false,
        createdAt: now(),
        ownerUserId: options.ownerUserId || null,
        clientKey: options.clientKey || "rhythm-reactions-cic"
    };
    state.projects.push(project);
    saveState(state);
    return project;
}

export function approveKickoff(projectId) {
    const state = loadState();
    const project = state.projects.find((p) => p.id === projectId);
    assert(project, `Project ${projectId} not found`);
    project.kickoffApproved = true;
    project.kickoffApprovedAt = now();
    saveState(state);
    return project;
}

export function generateBatch(projectId, count = 3) {
    const state = loadState();
    const project = state.projects.find((p) => p.id === projectId);
    assert(project, `Project ${projectId} not found`);
    assert(project.kickoffApproved, "Kickoff not approved; workflow is locked");
    const created = [];
    for (let i = 0; i < count; i += 1) {
        const id = nextId(state, "asset");
        const asset = {
            id,
            projectId,
            title: `Asset ${id}`,
            stage: "draft",
            priority: "normal",
            createdAt: now(),
            transitions: [{ from: null, to: "draft", at: now() }],
            gateChecks: { brand: false, scope: false, requiredContent: false }
        };
        state.assets.push(asset);
        created.push(asset);
    }

    saveState(state);
    return created;
}

export function listAssets(projectId) {
    const state = loadState();
    return state.assets.filter((a) => a.projectId === projectId);
}

export function getAsset(assetId) {
    const state = loadState();
    return state.assets.find((a) => a.id === assetId) || null;
}

export function setAssetPriority(assetId, priority) {
    const state = loadState();
    const asset = state.assets.find((a) => a.id === assetId);
    assert(asset, `Asset ${assetId} not found`);
    assert(
        priority === "critical" || priority === "high" || priority === "normal" || priority === "low",
        "Invalid priority; expected critical, high, normal, or low"
    );
    asset.priority = priority;
    saveState(state);
    return asset;
}

export function moveAssetToReview(assetId) {
    const state = loadState();
    const asset = state.assets.find((a) => a.id === assetId);
    assert(asset, `Asset ${assetId} not found`);
    if (asset.stage === "draft") {
        applyTransition(asset, "review");
        saveState(state);
    }
    return asset;
}

function priorityScore(priority) {
    if (priority === "critical") {
        return 1;
    }
    if (priority === "high") {
        return 2;
    }
    if (priority === "normal") {
        return 3;
    }
    if (priority === "low") {
        return 4;
    }
    return 5;
}

export function prioritizeBacklog(projectId) {
    const state = loadState();
    const project = state.projects.find((p) => p.id === projectId);
    assert(project, `Project ${projectId} not found`);

    return state.assets
        .filter((a) => a.projectId === projectId)
        .filter((a) => a.stage !== "published" && a.stage !== "rejected")
        .slice()
        .sort((a, b) => {
            const aPriority = priorityScore(a.priority);
            const bPriority = priorityScore(b.priority);
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }

            const aStage = BACKLOG_STAGE_WEIGHT[a.stage] ?? 50;
            const bStage = BACKLOG_STAGE_WEIGHT[b.stage] ?? 50;
            if (aStage !== bStage) {
                return aStage - bStage;
            }

            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
}

export function applyAsyncApprovalExpiry(projectId, options = {}) {
    const state = loadState();
    const project = state.projects.find((p) => p.id === projectId);
    assert(project, `Project ${projectId} not found`);

    const timeoutHours = Number(options.timeoutHours ?? 48);
    const defaultAction = options.defaultAction || "request_changes";
    assert(timeoutHours > 0, "timeoutHours must be greater than 0");
    assert(
        defaultAction === "request_changes" || defaultAction === "reject",
        "defaultAction must be request_changes or reject"
    );

    const currentTimeMs = Number(options.currentTimeMs ?? Date.now());
    assert(Number.isFinite(currentTimeMs), "currentTimeMs must be a valid number");

    const cutoffMs = currentTimeMs - timeoutHours * 60 * 60 * 1000;
    const updated = [];

    for (const asset of state.assets) {
        if (asset.projectId !== projectId || asset.stage !== "review") {
            continue;
        }
        const lastTransition = asset.transitions[asset.transitions.length - 1];
        const transitionMs = new Date(lastTransition.at).getTime();
        if (transitionMs > cutoffMs) {
            continue;
        }

        if (defaultAction === "request_changes") {
            applyTransition(asset, "changes_requested");
        } else {
            applyTransition(asset, "rejected");
        }

        asset.asyncEscalatedAt = now();
        updated.push({ id: asset.id, stage: asset.stage });
    }

    saveState(state);
    return {
        timeoutHours,
        defaultAction,
        escalatedCount: updated.length,
        escalatedAssets: updated
    };
}

function applyTransition(asset, to, gateChecks) {
    const allowed = ALLOWED_TRANSITIONS[asset.stage] || [];
    assert(allowed.includes(to), `Invalid transition ${asset.stage} -> ${to}`);

    if (to === "approved" || to === "published") {
        const checks = gateChecks || asset.gateChecks;
        assert(checks.brand === true, "Gate failed: brand must pass");
        assert(checks.scope === true, "Gate failed: scope must pass");
        assert(checks.requiredContent === true, "Gate failed: requiredContent must pass");
        asset.gateChecks = checks;
    }

    const from = asset.stage;
    asset.stage = to;
    asset.transitions.push({ from, to, at: now() });
}

export function reviewAsset(assetId, action, gateChecks) {
    const state = loadState();
    const asset = state.assets.find((a) => a.id === assetId);
    assert(asset, `Asset ${assetId} not found`);

    if (asset.stage === "draft") {
        applyTransition(asset, "review", gateChecks);
    }

    if (action === "approve") {
        applyTransition(asset, "approved", gateChecks);
    } else if (action === "reject") {
        applyTransition(asset, "rejected", gateChecks);
    } else if (action === "request_changes") {
        applyTransition(asset, "changes_requested", gateChecks);
    } else {
        assert(false, `Unknown review action ${action}`);
    }

    saveState(state);
    return asset;
}

export function publishAsset(assetId, gateChecks) {
    const state = loadState();
    const asset = state.assets.find((a) => a.id === assetId);
    assert(asset, `Asset ${assetId} not found`);
    applyTransition(asset, "published", gateChecks);
    saveState(state);
    return asset;
}

export function computeMetrics(projectId) {
    const state = loadState();
    const assets = state.assets.filter((a) => a.projectId === projectId);
    const published = assets.filter((a) => a.stage === "published");
    const approved = assets.filter((a) => a.stage === "approved" || a.stage === "published");

    const throughput = published.length;
    const passRate = assets.length === 0 ? 0 : Number((approved.length / assets.length).toFixed(2));

    let totalMinutes = 0;
    let measured = 0;
    for (const asset of published) {
        const start = asset.transitions.find((t) => t.to === "draft");
        const end = asset.transitions.find((t) => t.to === "published");
        if (start && end) {
            const minutes = (new Date(end.at).getTime() - new Date(start.at).getTime()) / 60000;
            totalMinutes += minutes;
            measured += 1;
        }
    }

    const cycleTimeMinutes = measured === 0 ? 0 : Number((totalMinutes / measured).toFixed(2));
    return { throughput, passRate, cycleTimeMinutes, measuredAssets: measured, totalAssets: assets.length };
}

export function recordLoop(projectId, notes = "") {
    const state = loadState();
    const project = state.projects.find((p) => p.id === projectId);
    assert(project, `Project ${projectId} not found`);

    const metrics = computeMetrics(projectId);
    const loopId = nextId(state, "loop");
    const loop = { id: loopId, projectId, metrics, notes, recordedAt: now() };
    state.loops.push(loop);
    saveState(state);
    return loop;
}

export function getProject(projectId) {
    const state = loadState();
    return state.projects.find((p) => p.id === projectId) || null;
}
