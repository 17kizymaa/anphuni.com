import fs from "node:fs";
import path from "node:path";
import { loadState } from "../src/store.mjs";
import { computeMetrics, applyAsyncApprovalExpiry } from "../src/pipeline.mjs";

const artifactsDir = path.resolve(process.cwd(), "artifacts");
const handoffPath = path.join(artifactsDir, "handoff-pack.json");
const runbookPath = path.join(artifactsDir, "operating-runbook.md");

if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
}

const state = loadState();
const latestProject = state.projects[state.projects.length - 1];
if (!latestProject) {
    throw new Error("No project found; run loop first");
}

const expiryResult = applyAsyncApprovalExpiry(latestProject.id, {
    timeoutHours: 48,
    defaultAction: "request_changes"
});

const projectAssets = state.assets.filter((a) => a.projectId === latestProject.id);
const openItems = projectAssets.filter((a) => a.stage !== "published");
const nextActions = [];

if (openItems.length > 0) {
    nextActions.push("Review open items and resolve gate failures.");
} else {
    nextActions.push("Generate next batch for upcoming weekly loop.");
}

nextActions.push("Record loop metrics after each publish batch.");
nextActions.push("Export handoff pack at end of each weekly cycle.");

const handoff = {
    generatedAt: new Date().toISOString(),
    project: latestProject,
    boardState: {
        totalAssets: projectAssets.length,
        byStage: projectAssets.reduce((acc, item) => {
            acc[item.stage] = (acc[item.stage] || 0) + 1;
            return acc;
        }, {})
    },
    metrics: computeMetrics(latestProject.id),
    expiryEnforcement: expiryResult,
    nextActions,
    asyncApprovalPolicy: {
        timeoutHours: 48,
        defaultAction: "request_changes",
        escalation: "If no response in 48h, move to request_changes and notify operator."
    }
};

fs.writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));

const runbook = [
    "# Operating Runbook",
    "",
    "## Weekly Rhythm",
    "",
    "1. Monday: Generate a new draft batch.",
    "2. Tuesday: Run review and quality gate checks.",
    "3. Wednesday: Approve and publish passing items.",
    "4. Thursday: Measure throughput, pass-rate, and cycle-time.",
    "5. Friday: Export handoff pack and queue next actions.",
    "",
    "## Escalation",
    "",
    "- If client approval is delayed beyond 48 hours, set item to request_changes.",
    "- Log the delay in the loop execution log.",
    "- Continue pipeline with next highest-priority item.",
    "",
    "## Async Handoff Contract",
    "",
    "- Handoff package must include board snapshot, metrics, and next actions.",
    "- No live meeting required to continue next loop.",
    "- Operator can resume work from handoff pack only."
].join("\\n");

fs.writeFileSync(runbookPath, runbook);
console.log(JSON.stringify({ handoffPath, runbookPath }, null, 2));
