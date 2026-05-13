import { createServer } from "node:http";
import {
    createProject,
    approveKickoff,
    generateBatch,
    setAssetPriority,
    moveAssetToReview,
    prioritizeBacklog,
    listAssets,
    getAsset,
    reviewAsset,
    publishAsset,
    computeMetrics,
    recordLoop,
    applyAsyncApprovalExpiry,
    getProject
} from "./pipeline.mjs";
import { loadState, saveState, nextId } from "./store.mjs";
import { normalizeEmail, hashPassword, verifyPassword, generateToken } from "./auth.mjs";
import { parseCookies, buildSetCookie } from "./http-auth.mjs";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const APP_CLIENT_KEY = "rhythm-reactions-cic";
const MAX_USERS = 2;
const SESSION_COOKIE = "pipeline_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
    res.end(JSON.stringify(body, null, 2));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
        });
        req.on("end", () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (err) {
                reject(err);
            }
        });
    });
}

function routeMatch(url, pattern) {
    const parts = url.split("?")[0].split("/").filter(Boolean);
    const patternParts = pattern.split("/").filter(Boolean);
    if (parts.length !== patternParts.length) {
        return null;
    }

    const params = {};
    for (let i = 0; i < parts.length; i += 1) {
        const p = patternParts[i];
        const v = parts[i];
        if (p.startsWith(":")) {
            params[p.slice(1)] = v;
        } else if (p !== v) {
            return null;
        }
    }
    return params;
}

function assert(condition, message, status = 400) {
    if (!condition) {
        const err = new Error(message);
        err.status = status;
        throw err;
    }
}

function now() {
    return new Date().toISOString();
}

function sanitizeUser(user) {
    return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        clientKey: user.clientKey,
        createdAt: user.createdAt
    };
}

function removeExpiredSessions(state) {
    const currentMs = Date.now();
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((s) => new Date(s.expiresAt).getTime() > currentMs);
    if (state.sessions.length !== before) {
        saveState(state);
    }
}

function getAuthenticatedUser(req) {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    if (!token) {
        return null;
    }

    const state = loadState();
    removeExpiredSessions(state);
    const session = state.sessions.find((s) => s.token === token);
    if (!session) {
        return null;
    }
    const user = state.users.find((u) => u.id === session.userId);
    if (!user) {
        return null;
    }
    return user;
}

function requireAuthenticatedUser(req) {
    const user = getAuthenticatedUser(req);
    assert(user, "Authentication required", 401);
    assert(user.clientKey === APP_CLIENT_KEY, "User not authorized for this client", 403);
    return user;
}

function requireProjectAccess(user, projectId) {
    const project = getProject(projectId);
    assert(project, `Project ${projectId} not found`, 404);
    assert(project.clientKey === APP_CLIENT_KEY, "Project is not in allowed client scope", 403);
    assert(user.clientKey === project.clientKey, "User cannot access this project", 403);
    return project;
}

function requireAssetProjectAccess(user, assetId) {
    const asset = getAsset(assetId);
    assert(asset, `Asset ${assetId} not found`, 404);
    const project = requireProjectAccess(user, asset.projectId);
    return { asset, project };
}

function createSessionForUser(state, userId) {
    const sessionId = nextId(state, "session");
    const token = generateToken();
    const issuedAt = Date.now();
    const session = {
        id: sessionId,
        userId,
        token,
        createdAt: new Date(issuedAt).toISOString(),
        expiresAt: new Date(issuedAt + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
    };
    state.sessions.push(session);
    return session;
}

function clearSessionByToken(state, token) {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.token !== token);
    return state.sessions.length !== before;
}

const server = createServer(async (req, res) => {
    try {
        if (req.method === "GET" && req.url === "/health") {
            return sendJson(res, 200, { ok: true, service: "pipeline-mvp" });
        }

        if (req.method === "POST" && req.url === "/auth/register") {
            const body = await parseBody(req);
            const email = normalizeEmail(body.email);
            const password = String(body.password || "");
            const displayName = String(body.displayName || email);
            const role = body.role === "client" ? "client" : "operator";
            const clientKey = String(body.clientKey || APP_CLIENT_KEY).trim().toLowerCase();

            assert(email && email.includes("@"), "Valid email is required", 400);
            assert(password.length >= 8, "Password must be at least 8 characters", 400);
            assert(clientKey === APP_CLIENT_KEY, "Only rhythm-reactions-cic client scope is allowed", 403);

            const state = loadState();
            removeExpiredSessions(state);
            assert(state.users.length < MAX_USERS, `Registration limit reached (${MAX_USERS} users)`, 403);
            assert(!state.users.some((u) => u.email === email), "Email already registered", 409);

            const pass = hashPassword(password);
            const user = {
                id: nextId(state, "user"),
                email,
                displayName,
                role,
                clientKey,
                passwordHash: pass.hash,
                passwordSalt: pass.salt,
                createdAt: now()
            };
            state.users.push(user);
            const session = createSessionForUser(state, user.id);
            saveState(state);

            return sendJson(
                res,
                201,
                { user: sanitizeUser(user), registered: true },
                {
                    "Set-Cookie": buildSetCookie(SESSION_COOKIE, session.token, {
                        maxAge: SESSION_MAX_AGE_SECONDS,
                        httpOnly: true,
                        sameSite: "Lax"
                    })
                }
            );
        }

        if (req.method === "POST" && req.url === "/auth/login") {
            const body = await parseBody(req);
            const email = normalizeEmail(body.email);
            const password = String(body.password || "");
            assert(email, "Email is required", 400);
            assert(password, "Password is required", 400);

            const state = loadState();
            removeExpiredSessions(state);
            const user = state.users.find((u) => u.email === email);
            assert(user, "Invalid email or password", 401);
            assert(verifyPassword(password, user.passwordSalt, user.passwordHash), "Invalid email or password", 401);
            assert(user.clientKey === APP_CLIENT_KEY, "User not in allowed client scope", 403);

            const session = createSessionForUser(state, user.id);
            saveState(state);

            return sendJson(
                res,
                200,
                { user: sanitizeUser(user), authenticated: true },
                {
                    "Set-Cookie": buildSetCookie(SESSION_COOKIE, session.token, {
                        maxAge: SESSION_MAX_AGE_SECONDS,
                        httpOnly: true,
                        sameSite: "Lax"
                    })
                }
            );
        }

        if (req.method === "POST" && req.url === "/auth/logout") {
            const cookies = parseCookies(req);
            const token = cookies[SESSION_COOKIE];
            if (token) {
                const state = loadState();
                const changed = clearSessionByToken(state, token);
                if (changed) {
                    saveState(state);
                }
            }
            return sendJson(
                res,
                200,
                { authenticated: false },
                {
                    "Set-Cookie": buildSetCookie(SESSION_COOKIE, "", {
                        maxAge: 0,
                        httpOnly: true,
                        sameSite: "Lax"
                    })
                }
            );
        }

        if (req.method === "GET" && req.url === "/auth/me") {
            const user = getAuthenticatedUser(req);
            return sendJson(res, 200, { user: user ? sanitizeUser(user) : null });
        }

        const user = requireAuthenticatedUser(req);

        if (req.method === "POST" && req.url === "/projects") {
            const body = await parseBody(req);
            return sendJson(
                res,
                201,
                createProject(body.name || "Untitled Project", {
                    ownerUserId: user.id,
                    clientKey: user.clientKey
                })
            );
        }

        const kickoffParams = routeMatch(req.url || "", "/projects/:projectId/kickoff-approve");
        if (req.method === "POST" && kickoffParams) {
            requireProjectAccess(user, kickoffParams.projectId);
            return sendJson(res, 200, approveKickoff(kickoffParams.projectId));
        }

        const batchParams = routeMatch(req.url || "", "/projects/:projectId/batch-generate");
        if (req.method === "POST" && batchParams) {
            requireProjectAccess(user, batchParams.projectId);
            const body = await parseBody(req);
            return sendJson(res, 201, generateBatch(batchParams.projectId, Number(body.count || 3)));
        }

        const assetsParams = routeMatch(req.url || "", "/projects/:projectId/assets");
        if (req.method === "GET" && assetsParams) {
            requireProjectAccess(user, assetsParams.projectId);
            return sendJson(res, 200, listAssets(assetsParams.projectId));
        }

        const backlogParams = routeMatch(req.url || "", "/projects/:projectId/backlog");
        if (req.method === "GET" && backlogParams) {
            requireProjectAccess(user, backlogParams.projectId);
            return sendJson(res, 200, prioritizeBacklog(backlogParams.projectId));
        }

        const reviewParams = routeMatch(req.url || "", "/assets/:assetId/review");
        if (req.method === "POST" && reviewParams) {
            requireAssetProjectAccess(user, reviewParams.assetId);
            const body = await parseBody(req);
            return sendJson(res, 200, reviewAsset(reviewParams.assetId, body.action, body.gateChecks));
        }

        const reviewQueueParams = routeMatch(req.url || "", "/assets/:assetId/review-queue");
        if (req.method === "POST" && reviewQueueParams) {
            requireAssetProjectAccess(user, reviewQueueParams.assetId);
            return sendJson(res, 200, moveAssetToReview(reviewQueueParams.assetId));
        }

        const priorityParams = routeMatch(req.url || "", "/assets/:assetId/priority");
        if (req.method === "POST" && priorityParams) {
            requireAssetProjectAccess(user, priorityParams.assetId);
            const body = await parseBody(req);
            return sendJson(res, 200, setAssetPriority(priorityParams.assetId, body.priority));
        }

        const publishParams = routeMatch(req.url || "", "/assets/:assetId/publish");
        if (req.method === "POST" && publishParams) {
            requireAssetProjectAccess(user, publishParams.assetId);
            const body = await parseBody(req);
            return sendJson(res, 200, publishAsset(publishParams.assetId, body.gateChecks));
        }

        const metricsParams = routeMatch(req.url || "", "/projects/:projectId/metrics");
        if (req.method === "GET" && metricsParams) {
            requireProjectAccess(user, metricsParams.projectId);
            return sendJson(res, 200, computeMetrics(metricsParams.projectId));
        }

        const loopParams = routeMatch(req.url || "", "/projects/:projectId/loops/record");
        if (req.method === "POST" && loopParams) {
            requireProjectAccess(user, loopParams.projectId);
            const body = await parseBody(req);
            return sendJson(res, 201, recordLoop(loopParams.projectId, body.notes || ""));
        }

        const expiryParams = routeMatch(req.url || "", "/projects/:projectId/approvals/expire");
        if (req.method === "POST" && expiryParams) {
            requireProjectAccess(user, expiryParams.projectId);
            const body = await parseBody(req);
            return sendJson(
                res,
                200,
                applyAsyncApprovalExpiry(expiryParams.projectId, {
                    timeoutHours: body.timeoutHours,
                    defaultAction: body.defaultAction
                })
            );
        }

        const projectParams = routeMatch(req.url || "", "/projects/:projectId");
        if (req.method === "GET" && projectParams) {
            requireProjectAccess(user, projectParams.projectId);
            const project = getProject(projectParams.projectId);
            return sendJson(res, 200, project);
        }

        return sendJson(res, 404, { error: "Not found" });
    } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message || "Internal error" });
    }
});

server.listen(PORT, () => {
    console.log(`pipeline-mvp listening on http://localhost:${PORT}`);
});
