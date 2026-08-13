/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';

export function JsonValueEditor({
  value,
  onChange,
  readonly,
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const defaultJsonText = useMemo(() => JSON.stringify(value, null, 2), [value]);

  const [jsonText, setJsonText] = useState(defaultJsonText);
  const effectVersion = useRef(0);
  const changeVersion = useRef(0);

  const handleJsonTextChange = (text: string) => {
    setJsonText(text);
    try {
      const jsonValue = JSON.parse(text) as Record<string, unknown>;
      onChange(jsonValue);
      changeVersion.current++;
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    // more effect compared with change
    effectVersion.current = effectVersion.current + 1;
    if (effectVersion.current === changeVersion.current) {
      return;
    }
    effectVersion.current = changeVersion.current;

    setJsonText(JSON.stringify(value, null, 2));
  }, [value]);

  return (
    <CodeMirror
      data-json-value-editor="true"
      className="min-h-40 overflow-hidden rounded-lg border border-input bg-background text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 [&_.cm-editor]:min-h-40 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none [&_.cm-scroller]:min-h-40 [&_.cm-scroller]:overflow-auto [&_.cm-content]:min-h-40 [&_.cm-content]:p-2.5 [&_.cm-content]:font-mono [&_.cm-content]:text-xs"
      value={jsonText}
      theme="none"
      basicSetup={{ foldGutter: false }}
      extensions={[json()]}
      editable={!readonly}
      readOnly={readonly}
      onCreateEditor={(view) => view.contentDOM.setAttribute('aria-label', 'JSON value')}
      onChange={handleJsonTextChange}
    />
  );
}
