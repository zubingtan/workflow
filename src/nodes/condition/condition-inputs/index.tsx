/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { createPortal } from 'react-dom';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { nanoid } from 'nanoid';
import { Plus, X } from 'lucide-react';
import type { WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor';
import { Field, FieldArray } from '@flowgram.ai/free-layout-editor';

import { ConditionRow } from '@/form-semantics';
import { conditionRowRuleConfig } from '@/form-semantics';
import type { ConditionRowValueType } from '@/form-semantics';
import { Button } from '@/components/ui';

import { hasTargetElement, rotatePortLocation } from '../../../utils/rotate-ports';
import { useNodeRenderContext } from '../../../hooks';
import { FormItem } from '../../../form-components';
import { Feedback } from '../../../form-components';
import { useConditionPortOrder } from './use-condition-port-order';
import { useConditionPortLocation } from './use-condition-port-location';
import { ConditionPort } from './styles';

interface ConditionValue {
  key: string;
  value?: ConditionRowValueType;
}

export function ConditionInputs() {
  const { node, readonly } = useNodeRenderContext();
  return (
    <FieldArray name="conditions">
      {({ field }) => <ConditionBranches field={field} node={node} readonly={readonly} />}
    </FieldArray>
  );
}

function ConditionBranches({
  field,
  node,
  readonly,
}: {
  field: any;
  node: WorkflowNodeEntity;
  readonly: boolean;
}) {
  // #190: dynamic output ports are DOM-driven; rotate by switching CSS edge
  // + `data-port-location` attribute, NOT by `port.update()`.
  const { direction, vertical, portLocation } = useConditionPortLocation();

  // The node element (`.gedit-flow-activity-node`, position:absolute) is the
  // portal target for TB-mode ports so CSS `bottom/left` anchors them to the
  // node's bottom edge with no JS offset math.
  const markerRef = useRef<HTMLSpanElement>(null);
  const [nodeEl, setNodeEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setNodeEl(markerRef.current?.closest('.gedit-flow-activity-node') as HTMLElement | null);
  }, []);

  const portIds = useMemo(
    () => [...(field.value ?? []).map((v: ConditionValue) => v.key), 'else'],
    [field.value]
  );
  const order = useConditionPortOrder(node, portIds);

  // When the port order changes the anchors move (inline `left`), but
  // FlowGram only re-renders a connection line when the port entity fires a
  // change — and moving the anchor's `left` (same targetElement reference)
  // does not. Force a re-render so the branch lines follow the new order
  // instead of staying at the stale (crossing) positions.
  const prevOrder = useRef(order);
  useLayoutEffect(() => {
    if (prevOrder.current === order) return;
    prevOrder.current = order;
    node.document.fireRender();
  }, [order, node]);

  useLayoutEffect(() => {
    node.ports.updateDynamicPorts();
    // `updateDynamicPorts()` rebuilds port entities from `_staticPorts`
    // (which lacks a `location` field), resetting the input port's
    // `_location` to undefined → default 'left'. Re-apply the current
    // direction so the static input port stays on 'top' in TB mode.
    for (const port of node.ports.allPorts) {
      if (hasTargetElement(port)) continue;
      const loc = rotatePortLocation(port.portType, direction);
      if (port.location !== loc) {
        port.update({ location: loc } as any);
      }
    }
    // nodeEl: re-run once the portal target (and thus TB ports) is in the DOM.
  }, [node, vertical, direction, nodeEl]);

  return (
    <>
      <span ref={markerRef} style={{ display: 'none' }} />
      {field.map((child: any, index: number) => (
        <Field<ConditionValue> key={child.name} name={child.name}>
          {({ field: childField, fieldState: childState }) => (
            <FormItem name="if" type="boolean" required={true} labelWidth={50}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <ConditionRow
                  readonly={readonly}
                  ruleConfig={conditionRowRuleConfig}
                  style={{ flexGrow: 1, overflow: 'hidden' }}
                  value={childField.value.value}
                  onChange={(v) => childField.onChange({ value: v, key: childField.value.key })}
                />

                {!readonly && (
                  <Button variant="ghost" disabled={readonly} onClick={() => field.delete(index)}>
                    <X />
                  </Button>
                )}
              </div>

              <Feedback errors={childState?.errors} invalid={childState?.invalid} />
              {!vertical && (
                <ConditionPort
                  $vertical={false}
                  data-port-id={childField.value.key}
                  data-port-type="output"
                  data-port-location={portLocation}
                />
              )}
            </FormItem>
          )}
        </Field>
      ))}
      <FormItem name="else" type="boolean" required={true} labelWidth={100}>
        {!vertical && (
          <ConditionPort
            $vertical={false}
            data-port-id="else"
            data-port-type="output"
            data-port-location={portLocation}
          />
        )}
      </FormItem>
      {!readonly && (
        <div>
          <Button
            variant="ghost"
            aria-label="plus Add"
            onClick={() =>
              field.append({
                key: `if_${nanoid(6)}`,
                value: { type: 'expression', content: '' },
              })
            }
          >
            <Plus /> Add
          </Button>
        </div>
      )}
      {vertical &&
        nodeEl &&
        createPortal(
          <>
            {portIds.map((id, i) => {
              const slot = order.get(id) ?? i;
              const fraction = (slot + 1) / (portIds.length + 1);
              return (
                <ConditionPort
                  key={id}
                  $vertical
                  style={{ left: `${fraction * 100}%` }}
                  data-port-id={id}
                  data-port-type="output"
                  data-port-location={portLocation}
                />
              );
            })}
          </>,
          nodeEl
        )}
    </>
  );
}
