import crypto from "node:crypto";

const KEYLEN = 64;
const HASH_ALGORITHM = "sha512";

export function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(String(password || ""), salt, KEYLEN).toString("hex");
    return { salt, hash, algorithm: HASH_ALGORITHM };
}

export function verifyPassword(password, salt, expectedHash) {
    const hash = crypto.scryptSync(String(password || ""), salt, KEYLEN).toString("hex");
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(String(expectedHash || ""), "hex");
    if (a.length !== b.length) {
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

export function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}
