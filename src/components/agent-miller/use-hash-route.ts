import { useState, useEffect, useCallback } from 'react';

export interface AgentRoute {
  agentId: string | null;
  section: string | null;
}

function parseHash(): AgentRoute {
  const hash = window.location.hash;
  const match = hash.match(/^#\/agents\/([^/]+)(?:\/([^/]+))?/);
  if (!match) return { agentId: null, section: null };
  return { agentId: match[1], section: match[2] || null };
}

export function useHashRoute() {
  const [route, setRoute] = useState<AgentRoute>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((agentId: string | null, section?: string | null) => {
    if (!agentId) {
      window.location.hash = '#/agents';
    } else if (section) {
      window.location.hash = `#/agents/${agentId}/${section}`;
    } else {
      window.location.hash = `#/agents/${agentId}`;
    }
  }, []);

  return { route, navigate };
}
