/**
 * Telemetry — anonymous usage tracking.
 *
 * Completely silent when MEM0_TELEMETRY=false (default for self-hosted).
 * When enabled, logs events to console at debug level. No external network
 * calls are made in the self-hosted fork.
 */

function isTelemetryEnabled(): boolean {
  const val = process.env.MEM0_TELEMETRY;
  if (val === undefined) return false; // default OFF for self-hosted
  const s = val.toLowerCase();
  return s !== 'false' && s !== '0' && s !== 'no' && s !== 'off';
}

export function captureEvent(eventName: string, properties: Record<string, unknown> = {}): void {
  if (!isTelemetryEnabled()) return;
  console.debug(`[mem0:telemetry] ${eventName}`, properties);
}

export function captureToolEvent(action: string, properties: Record<string, unknown> = {}): void {
  captureEvent('tool.mem0_memory', { action, ...properties });
}
