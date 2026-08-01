interface MemoryLike {
  id: string;
  memory?: string;
  createdAt?: string;
}

export function formatAge(date: string): string {
  const d = new Date(date);
  const ms = Date.now() - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatMemoryCompact(mem: MemoryLike): string {
  const age = mem.createdAt ? ` (${formatAge(mem.createdAt)})` : '';
  return `${mem.memory ?? '(empty)'}${age} [mem0:${mem.id}]`;
}

export function formatMemoryList(memories: MemoryLike[]): string {
  if (memories.length === 0) return 'No memories found.';
  return memories.map((m, i) => `${i + 1}. ${formatMemoryCompact(m)}`).join('\n');
}
