import { useState, useEffect, useMemo } from 'react';

import { Input, Button, Tag } from '../../ui/management';
import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  draft?: { name?: string; tags?: string[] };
}

export function GeneralSection({ agent, debouncedSave, draft }: Props) {
  const tags: string[] = useMemo(() => {
    if (draft?.tags) return draft.tags;
    try {
      return JSON.parse(agent.tags || '[]');
    } catch {
      return [];
    }
  }, [agent.tags, draft?.tags]);

  const [name, setName] = useState(draft?.name ?? agent.name);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setName(draft?.name ?? agent.name);
  }, [agent.id, agent.name, draft?.name]);

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    const newTags = [...tags, t];
    debouncedSave(agent.id, { tags: newTags });
    setTagInput('');
  };

  const removeTag = (t: string) => {
    const newTags = tags.filter((x) => x !== t);
    debouncedSave(agent.id, { tags: newTags });
  };

  const fieldStyle = { marginBottom: 16 };
  const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 } as const;

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 16 }}>Basic</h3>
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="agent-name">
          Name
        </label>
        <Input
          id="agent-name"
          value={name}
          onChange={setName}
          onBlur={() => {
            if (name !== agent.name) debouncedSave(agent.id, { name });
          }}
        />
      </div>

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Tags</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map((t) => (
          <Tag key={t} closable onClose={() => removeTag(t)} color="blue">
            {t}
          </Tag>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          size="small"
          value={tagInput}
          onChange={setTagInput}
          placeholder="Add tag..."
          onEnterPress={addTag}
          style={{ width: 160 }}
        />
        <Button size="small" onClick={addTag}>
          Add
        </Button>
      </div>
    </div>
  );
}
