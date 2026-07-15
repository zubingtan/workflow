const url = process.argv[2] ?? `http://localhost:${process.env.APP_PORT ?? "3000"}/api/health/ready`;
const response = await fetch(url);
if (!response.ok) throw new Error(`Readiness returned HTTP ${response.status}`);
const body = await response.json();
if (body.status !== "ready") throw new Error("Application is not ready");
console.log("PASS: running stack is ready");
