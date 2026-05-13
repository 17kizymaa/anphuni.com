import fs from "node:fs";
import path from "node:path";
import {
    createProject,
    approveKickoff,
    generateBatch,
    reviewAsset,
    publishAsset,
    computeMetrics,
    recordLoop,
    listAssets
} from "../src/pipeline.mjs";

const artifactsDir = path.resolve(process.cwd(), "artifacts");
const logPath = path.join(artifactsDir, "loop-execution.log");
const metricsPath = path.join(artifactsDir, "loop-metrics.json");

if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
}

function write(line) {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
}

if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
}

write("Starting MVP loop run");
const project = createProject("RRC Pipeline MVP", { clientKey: "rhythm-reactions-cic" });
write(`Project created: ${project.id}`);
approveKickoff(project.id);
write(`Kickoff approved: ${project.id}`);

const batch = generateBatch(project.id, 3);
write(`Batch generated: ${batch.length} assets`);

for (const asset of batch) {
    reviewAsset(asset.id, "approve", { brand: true, scope: true, requiredContent: true });
    publishAsset(asset.id, { brand: true, scope: true, requiredContent: true });
    write(`Asset published: ${asset.id}`);
}

const metrics = computeMetrics(project.id);
const loop = recordLoop(project.id, "Automated MVP evidence loop");

fs.writeFileSync(metricsPath, JSON.stringify({ projectId: project.id, metrics, loop }, null, 2));
write(`Metrics persisted: throughput=${metrics.throughput}, passRate=${metrics.passRate}`);
write(`Assets total: ${listAssets(project.id).length}`);
write("MVP loop run complete");

console.log(JSON.stringify({ projectId: project.id, metrics, loopId: loop.id }, null, 2));
