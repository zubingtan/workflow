/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { createPortal } from 'react-dom';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { nanoid } from 'nanoid';
import { Plus, Trash2, X } from 'lucide-react';
import type { WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor';
import { Field, FieldArray, I18n, WorkflowNodePortsData } from '@flowgram.ai/free-layout-editor';

import { ConditionRow } from '@/form-semantics';
import { conditionRowRuleConfig } from '@/form-semantics';
import type { ConditionRowValueType } from '@/form-semantics';
import { Button, Select } from '@/components/ui';

import { useConditionPortOrder } from '../../condition/condition-inputs/use-condition-port-order';
import { useConditionPortLocation } from '../../condition/condition-inputs/use-condition-port-location';
import { hasTargetElement, rotatePortLocation } from '../../../utils/rotate-ports';
import { useNodeRenderContext, useIsSidebar } from '../../../hooks';
import { Feedback, FormItem } from '../../../form-components';
import { ConditionBranch, ConditionBranchLogic, ConditionPort } from './styles';

interface ConditionValue {
  key: string;
  value?: ConditionRowValueType;
}

interface BranchItem {
  logic: string; // 'and' | 'or'
  conditions: ConditionValue[];
}

export function ConditionInputs() {
  const { node, readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  return (
    <FieldArray name="branch">
      {({ field: conditions }) => (
        <MultiConditionBranches
          conditions={conditions}
          node={node}
          readonly={readonly}
          isSidebar={isSidebar}
        />
      )}
    </FieldArray>
  );
}

function MultiConditionBranches({
  conditions,
  node,
  readonly,
  isSidebar,
}: {
  conditions: any;
  node: WorkflowNodeEntity;
  readonly: boolean;
  isSidebar: boolean;
}) {
  // #190: dynamic output ports are DOM-driven; rotate by switching CSS edge
  // + `data-port-location` attribute, NOT by `port.update()`.
  const { direction, vertical, portLocation } = useConditionPortLocation();

  const markerRef = useRef<HTMLSpanElement>(null);
  const [nodeEl, setNodeEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setNodeEl(markerRef.current?.closest('.gedit-flow-activity-node') as HTMLElement | null);
  }, []);

  const portIds = useMemo(() => {
    const names = conditions.map((b: any) => b.name) as string[];
    return [...names, 'else'];
  }, [conditions]);
  const order = useConditionPortOrder(node, portIds);

  // See condition/condition-inputs: force line re-render when the port
  // order changes so branch lines follow the new (non-crossing) anchor
  // positions instead of the stale ones.
  const prevOrder = useRef(order);
  useLayoutEffect(() => {
    if (prevOrder.current === order) return;
    prevOrder.current = order;
    node.document.fireRender();
  }, [order, node]);

  useLayoutEffect(() => {
    node.getData<WorkflowNodePortsData>(WorkflowNodePortsData).updateDynamicPorts();
    // Re-apply direction to static ports (see condition/condition-inputs
    // for the full rationale: `updateDynamicPorts` resets `_location`).
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
      {conditions.map((branch: any, index: number) => (
        <Field<BranchItem> name={branch.name} key={branch.name}>
          {({ field, fieldState }) => (
            <FormItem
              type="boolean"
              labelWidth={100}
              name={index === 0 ? I18n.t('IF') : I18n.t('ELSE-IF')}
              vertical
              required={index === 0}
            >
              <ConditionBranch>
                {field.value.conditions.length > 1 && (
                  <ConditionBranchLogic>
                    <Select
                      value={field.value.logic}
                      onChange={(v) =>
                        field.onChange({
                          ...field.value,
                          logic: v.currentTarget.value ?? 'and',
                        })
                      }
                    >
                      <option value="and">{I18n.t('AND')}</option>
                      <option value="or">{I18n.t('OR')}</option>
                    </Select>
                  </ConditionBranchLogic>
                )}
                <div style={{ flex: 1 }}>
                  {field.value.conditions.map((condition, childIndex) => (
                    <Field<ConditionValue>
                      name={`${field.name}.conditions.${childIndex}`}
                      key={condition.key}
                    >
                      {({ field: conditionField }) => (
                        <div className="flex items-center gap-1.5 py-1.5">
                          <div style={{ flex: 1 }}>
                            <ConditionRow
                              readonly={readonly}
                              ruleConfig={conditionRowRuleConfig}
                              value={conditionField.value.value}
                              onChange={(v) => {
                                conditionField.onChange({
                                  value: v,
                                  key: conditionField.value.key,
                                });
                              }}
                            />
                          </div>
                          {/*remove current branch condition*/}
                          {isSidebar && !readonly && (
                            <Button
                              disabled={field.value?.conditions.length === 1}
                              onClick={() =>
                                field.onChange({
                                  ...field.value,
                                  conditions: field.value.conditions.filter(
                                    (i: ConditionValue) => i.key !== condition.key
                                  ),
                                })
                              }
                            >
                              <X />
                            </Button>
                          )}
                        </div>
                      )}
                    </Field>
                  ))}
                </div>

                {!vertical && (
                  <ConditionPort
                    $vertical={false}
                    data-port-id={`${branch.name}`}
                    data-port-type="output"
                    data-port-location={portLocation}
                  />
                )}
              </ConditionBranch>

              {/* remove current branch and add new condition*/}
              {isSidebar && !readonly && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      field.onChange({
                        ...field.value,
                        conditions: [
                          ...field.value.conditions,
                          {
                            key: `condition_${nanoid(6)}`,
                            value: {},
                          },
                        ],
                      });
                    }}
                  >
                    <Plus /> {I18n.t('Add condition')}
                  </Button>
                  <Button
                    disabled={conditions.value?.length === 1}
                    size="sm"
                    variant="ghost"
                    onClick={() => conditions.remove(index)}
                  >
                    <Trash2 />
                    {I18n.t('Remove branch')}
                  </Button>
                </div>
              )}
              <Feedback errors={fieldState?.errors} invalid={fieldState?.invalid} />
            </FormItem>
          )}
        </Field>
      ))}

      {/*  else */}
      <FormItem name={I18n.t('ELSE')} type="boolean" required={true} labelWidth={100}>
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
            onClick={() =>
              conditions.append({
                logic: 'and',
                conditions: [
                  {
                    key: `condition_${nanoid(6)}`,
                    value: {},
                  },
                ],
              })
            }
          >
            <Plus /> {I18n.t('Add branch')}
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
