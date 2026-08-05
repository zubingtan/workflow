/**
 * PROTOTYPE — throwaway floating variant switcher.
 * Hidden in production builds.
 */
import { useCallback, useEffect } from 'react';

import { Button, Typography } from '@douyinfe/semi-ui';
import { IconArrowLeft, IconArrowRight } from '@douyinfe/semi-icons';

const VARIANTS = [
  { key: 'A', label: 'Inline Form — 内嵌表单' },
  { key: 'B', label: 'Modal Editor — 弹窗编辑' },
  { key: 'C', label: 'Card List — 卡片列表' },
];

export function getVariantFromSearch(): string {
  const m = window.location.hash.match(/[?&]variant=([A-C])/);
  return m?.[1] ?? 'A';
}

export function getVariantLabel(key: string): string {
  return VARIANTS.find((v) => v.key === key)?.label ?? 'Unknown';
}

export function getVariantTitle(key: string): string {
  return `Variant ${key} — ${getVariantLabel(key)}`;
}

export default function PrototypeSwitcher() {
  const current = getVariantFromSearch();

  const goTo = useCallback((key: string) => {
    const base = window.location.hash.replace(/[?&]variant=[A-C]/, '');
    const sep = base.includes('?') ? '&' : '?';
    window.location.hash = `${base}${sep}variant=${key}`;
  }, []);

  const prev =
    VARIANTS[
      (VARIANTS.findIndex((v) => v.key === current) - 1 + VARIANTS.length) % VARIANTS.length
    ];
  const next = VARIANTS[(VARIANTS.findIndex((v) => v.key === current) + 1) % VARIANTS.length];

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
        return;
      if (e.key === 'ArrowLeft') goTo(prev.key);
      if (e.key === 'ArrowRight') goTo(next.key);
    },
    [prev.key, next.key, goTo]
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 20px',
        background: 'var(--semi-color-bg-3)',
        border: '1px solid var(--semi-color-border)',
        borderRadius: 24,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}
    >
      <Button
        icon={<IconArrowLeft />}
        theme="borderless"
        size="small"
        onClick={() => goTo(prev.key)}
      />
      <Typography.Text size="small" strong>
        {getVariantTitle(current)}
      </Typography.Text>
      <Button
        icon={<IconArrowRight />}
        theme="borderless"
        size="small"
        onClick={() => goTo(next.key)}
      />
      <Typography.Text size="small" style={{ opacity: 0.5, marginLeft: 8 }}>
        {current}/{VARIANTS.length}
      </Typography.Text>
    </div>
  );
}
