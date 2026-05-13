export function parseCookies(req) {
    const cookieHeader = req.headers.cookie || "";
    const parts = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
    const out = {};
    for (const p of parts) {
        const i = p.indexOf("=");
        if (i <= 0) {
            continue;
        }
        const key = decodeURIComponent(p.slice(0, i).trim());
        const value = decodeURIComponent(p.slice(i + 1).trim());
        out[key] = value;
    }
    return out;
}

export function buildSetCookie(name, value, options = {}) {
    const attrs = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
    attrs.push(`Path=${options.path || "/"}`);
    if (options.httpOnly !== false) {
        attrs.push("HttpOnly");
    }
    if (options.sameSite) {
        attrs.push(`SameSite=${options.sameSite}`);
    } else {
        attrs.push("SameSite=Lax");
    }
    if (options.secure) {
        attrs.push("Secure");
    }
    if (typeof options.maxAge === "number") {
        attrs.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    }
    return attrs.join("; ");
}
