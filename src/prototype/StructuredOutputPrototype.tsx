/**
 * PROTOTYPE — Structured Output Schema 交互草案 (throwaway).
 * 3 variants switchable via ?variant=A|B|C hash param.
 * Router: #/prototype/structured-output
 *
 * Prototype question: "Agent 卡片设置面板下方新增结构化输出设置区域，
 * 应该用什么交互形式？"
 */
import { Typography, Button, Tag } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';

import VariantC from './VariantC';
import VariantB from './VariantB';
import VariantA from './VariantA';
import { getVariantFromSearch, getVariantTitle } from './PrototypeSwitcher';

export default function StructuredOutputPrototype() {
  const variant = getVariantFromSearch();

  const goBack = () => {
    window.location.hash = '#/workflows';
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--semi-color-bg-1)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 20px',
          borderBottom: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-bg-0)',
        }}
      >
        <Button icon={<IconArrowLeft />} theme="borderless" size="small" onClick={goBack}>
          Back
        </Button>
        <Typography.Title heading={5} style={{ margin: 0 }}>
          Prototype: Structured Output Schema
        </Typography.Title>
        <Tag color="orange" size="small" style={{ marginLeft: 8 }}>
          Throwaway — not production
        </Tag>
      </div>

      {/* Info banner */}
      <div
        style={{
          maxWidth: 520,
          margin: '16px auto 0',
          padding: '10px 16px',
          background: 'var(--semi-color-primary-light-default)',
          borderRadius: 6,
          border: '1px solid var(--semi-color-primary-light-active)',
        }}
      >
        <Typography.Text size="small">
          <strong>Current variant:</strong> {getVariantTitle(variant)}. Use{' '}
          <Tag size="small">←</Tag> <Tag size="small">→</Tag> arrow keys or the bottom bar to
          switch.{' '}
          <strong>
            Content below is the prototype — click around, add/remove fields, observe validation
            feedback.
          </strong>
        </Typography.Text>
      </div>

      {/* Active variant */}
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
    </div>
  );
}
