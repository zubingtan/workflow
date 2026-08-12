import { useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { JsonSchemaUtils } from '@flowgram.ai/json-schema';
import { Field } from '@flowgram.ai/free-layout-editor';
import { useAvailableVariables, useScopeAvailable } from '@flowgram.ai/editor';

import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

import type {
  AssignValueType,
  ConditionOpConfigs,
  ConditionRowValueType,
  IConditionRule,
  IFlowValue,
  IFlowRefValue,
  IFlowTemplateValue,
  IJsonSchema,
} from './types';
import { conditionRowRuleConfig } from './condition.mjs';

type FieldErrorLike = { message?: string };

const CONTROL_CLASS =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

function fieldText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('.');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function flowValueToText(value: IFlowValue | undefined): string {
  return fieldText(value?.content);
}

function parseConstant(value: string, schema?: IJsonSchema): unknown {
  switch (schema?.type) {
    case 'boolean':
      return value === 'true';
    case 'number':
    case 'integer':
      return value === '' ? undefined : Number(value);
    case 'array':
    case 'object':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

function pathValue(value: string): string[] {
  return value
    .trim()
    .replace(/^\{\{?|\}\}$/g, '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function updateFlowValue(
  previous: IFlowValue | undefined,
  mode: IFlowValue['type'],
  text: string,
  schema?: IJsonSchema
): IFlowValue {
  const base = previous && typeof previous === 'object' ? previous : {};
  if (mode === 'ref') return { ...base, type: 'ref', content: pathValue(text) } as IFlowRefValue;
  if (mode === 'constant')
    return { ...base, type: 'constant', content: parseConstant(text, schema) } as IFlowValue;
  return { ...base, type: mode, content: text } as IFlowValue;
}

export function DynamicValueInput({
  value,
  onChange,
  readonly,
  hasError,
  schema,
}: {
  value?: IFlowValue;
  onChange: (value: IFlowValue) => void;
  readonly?: boolean;
  hasError?: boolean;
  schema?: IJsonSchema;
}) {
  const mode = value?.type ?? 'constant';
  const isBoolean = mode === 'constant' && schema?.type === 'boolean';
  const text = flowValueToText(value);

  return (
    <div className="flex min-w-0 gap-1.5" data-editor-control="dynamic-value">
      <Select
        aria-label="Value type"
        className="w-[92px] shrink-0"
        value={mode}
        disabled={readonly}
        onChange={(event) =>
          onChange(
            updateFlowValue(value, event.currentTarget.value as IFlowValue['type'], text, schema)
          )
        }
      >
        <option value="constant">Value</option>
        <option value="ref">Variable</option>
        <option value="expression">Expression</option>
        <option value="template">Template</option>
      </Select>
      {mode === 'ref' ? (
        <VariablePicker
          value={Array.isArray(value?.content) ? value.content : pathValue(text)}
          onChange={(next) =>
            onChange({
              ...(value ?? {}),
              type: 'ref',
              content: next ?? [],
            } as IFlowRefValue)
          }
          readonly={readonly}
          hasError={hasError}
        />
      ) : isBoolean ? (
        <Select
          aria-label="Boolean value"
          className={cn(CONTROL_CLASS, hasError && 'border-destructive')}
          value={text === 'true' ? 'true' : 'false'}
          disabled={readonly}
          onChange={(event) =>
            onChange(updateFlowValue(value, 'constant', event.currentTarget.value, schema))
          }
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      ) : (
        <Input
          aria-invalid={hasError || undefined}
          className={cn(hasError && 'border-destructive')}
          type={
            mode === 'constant' && (schema?.type === 'number' || schema?.type === 'integer')
              ? 'number'
              : 'text'
          }
          value={text}
          disabled={readonly}
          onChange={(event) => onChange(updateFlowValue(value, mode, event.target.value, schema))}
        />
      )}
    </div>
  );
}

export function PromptEditorWithVariables({
  value,
  onChange,
  readonly,
  placeholder,
  hasError,
  style,
}: {
  value?: IFlowValue;
  onChange: (value: IFlowTemplateValue) => void;
  readonly?: boolean;
  placeholder?: string;
  hasError?: boolean;
  style?: React.CSSProperties;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(flowValueToText(value).length);
  const treeData = useVariableTree();
  const text = flowValueToText(value);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !editorRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const triggerMatch = (nextText: string, nextCursor: number) =>
    nextText.slice(0, nextCursor).match(/\{\{?[^{}]*$/);

  const updateOpenState = (nextText: string, nextCursor: number) => {
    setCursor(nextCursor);
    const nextOpen = Boolean(triggerMatch(nextText, nextCursor)) && !readonly;
    setOpen(nextOpen);
  };

  const insertVariable = (variable: string) => {
    const match = triggerMatch(text, cursor);
    const start = match ? cursor - match[0].length : cursor;
    const inserted = `{{${variable}}}`;
    const nextText = `${text.slice(0, start)}${inserted}${text.slice(cursor)}`;
    onChange({ ...(value ?? {}), type: 'template', content: nextText });
    setOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const nextCursor = start + inserted.length;
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
  };

  const textarea = (
    <div ref={editorRef} className="relative">
      <Textarea
        ref={textareaRef}
        aria-label="Template value"
        role="combobox"
        aria-autocomplete="list"
        className={cn('min-h-24 font-mono', hasError && 'border-destructive')}
        style={style}
        value={text}
        placeholder={placeholder ?? 'Write text or use {{variable.path}}'}
        readOnly={readonly}
        onFocus={(event) =>
          updateOpenState(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onClick={(event) =>
          updateOpenState(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onKeyUp={(event) => {
          if (event.key !== 'Escape') {
            updateOpenState(event.currentTarget.value, event.currentTarget.selectionStart);
          }
        }}
        onChange={(event) => {
          const nextText = event.target.value;
          const nextCursor = event.target.selectionStart;
          onChange({ ...(value ?? {}), type: 'template', content: nextText });
          updateOpenState(nextText, nextCursor);
        }}
      />
      {open && (
        <div
          role="dialog"
          aria-label="Variable suggestions"
          className="absolute left-0 top-full z-[1200] mt-1 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              textareaRef.current?.focus();
            }
          }}
        >
          <VariableTree treeData={treeData} onSelect={insertVariable} />
        </div>
      )}
    </div>
  );

  return textarea;
}

export function JsonEditorWithVariables({
  value,
  onChange,
  readonly,
  placeholder,
  activeLinePlaceholder,
}: {
  value?: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  placeholder?: string;
  activeLinePlaceholder?: string;
}) {
  return (
    <Textarea
      aria-label="JSON value"
      className="min-h-28 resize-y font-mono text-xs"
      spellCheck={false}
      value={value ?? ''}
      placeholder={placeholder ?? activeLinePlaceholder ?? '{\n  "key": "value"\n}'}
      disabled={readonly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TypeScriptCodeEditor({
  value,
  onChange,
  readonly,
}: {
  value?: string;
  onChange: (value: string) => void;
  readonly?: boolean;
}) {
  return (
    <Textarea
      aria-label="Code"
      className="min-h-44 resize-y bg-muted/40 font-mono text-xs"
      spellCheck={false}
      value={value ?? ''}
      disabled={readonly}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function schemaPropertyType(property?: IJsonSchema): string {
  return typeof property?.type === 'string' ? property.type : 'string';
}

export function DisplaySchemaTag({ value }: { value?: IJsonSchema }) {
  return (
    <span className="inline-flex shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {value?.type ?? 'any'}
    </span>
  );
}

export function JsonSchemaEditor({
  value,
  onChange,
  readonly,
}: {
  value?: IJsonSchema;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
}) {
  return (
    <div data-editor-control="schema-editor">
      <JsonSchemaObjectEditor value={value} onChange={onChange} readonly={readonly} />
    </div>
  );
}

function withSchemaProperties(
  value: IJsonSchema | undefined,
  properties: Record<string, IJsonSchema>,
  required?: string[]
): IJsonSchema {
  const next = { ...value, type: value?.type ?? 'object', properties };
  if (required !== undefined) next.required = required;
  return next;
}

function JsonSchemaObjectEditor({
  value,
  onChange,
  readonly,
  nested = false,
}: {
  value?: IJsonSchema;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
  nested?: boolean;
}) {
  const properties = value?.properties ?? {};
  const required = value?.required ?? [];
  const entries = Object.entries(properties);

  const updateProperty = (oldName: string, patch: Partial<IJsonSchema>) => {
    onChange(
      withSchemaProperties(value, {
        ...properties,
        [oldName]: { ...properties[oldName], ...patch },
      })
    );
  };

  const renameProperty = (oldName: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === oldName || properties[trimmed]) return;
    const nextProperties: Record<string, IJsonSchema> = {};
    for (const [key, property] of Object.entries(properties)) {
      nextProperties[key === oldName ? trimmed : key] = property;
    }
    onChange(
      withSchemaProperties(
        value,
        nextProperties,
        required.map((key) => (key === oldName ? trimmed : key))
      )
    );
  };

  const removeProperty = (name: string) => {
    const nextProperties = { ...properties };
    delete nextProperties[name];
    onChange(
      withSchemaProperties(
        value,
        nextProperties,
        required.filter((key) => key !== name)
      )
    );
  };

  const addProperty = () => {
    let name = 'field';
    let index = 1;
    while (properties[name]) name = `field_${index++}`;
    onChange(
      withSchemaProperties(value, {
        ...properties,
        [name]: { type: 'string' },
      })
    );
  };

  return (
    <div className={cn('flex flex-col gap-2', nested && 'border-l border-border pl-3')}>
      {entries.map(([name, property]) => (
        <div className="flex flex-col gap-1.5" key={name}>
          <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-1.5">
            <Input
              aria-label={`Schema field ${name}`}
              value={name}
              disabled={readonly}
              onChange={(event) => renameProperty(name, event.target.value)}
            />
            <Select
              aria-label={`Schema type ${name}`}
              value={schemaPropertyType(property)}
              disabled={readonly}
              onChange={(event) => updateProperty(name, { type: event.currentTarget.value })}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="integer">integer</option>
              <option value="boolean">boolean</option>
              <option value="array">array</option>
              <option value="object">object</option>
            </Select>
            <Button
              aria-label={`Remove schema field ${name}`}
              size="icon-sm"
              variant="ghost"
              disabled={readonly}
              onClick={() => removeProperty(name)}
            >
              <X />
            </Button>
            <label className="col-span-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Checkbox
                aria-label={`Required ${name}`}
                checked={required.includes(name)}
                disabled={readonly}
                onCheckedChange={(checked) =>
                  onChange(
                    withSchemaProperties(
                      value,
                      properties,
                      checked ? [...required, name] : required.filter((key) => key !== name)
                    )
                  )
                }
              />
              Required
            </label>
          </div>
          {schemaPropertyType(property) === 'object' && (
            <JsonSchemaObjectEditor
              value={property}
              onChange={(next) => updateProperty(name, next)}
              readonly={readonly}
              nested
            />
          )}
        </div>
      ))}
      {!readonly && (
        <Button className="w-fit" size="sm" variant="outline" onClick={addProperty}>
          <Plus data-icon="inline-start" />
          Add field
        </Button>
      )}
    </div>
  );
}

function valueLabel(value: IFlowValue | undefined): string {
  if (!value) return '—';
  if (value.type === 'ref') return `{{${fieldText(value.content)}}}`;
  return fieldText(value.content) || '—';
}

export function DisplayInputsValues({ value }: { value?: Record<string, IFlowValue | undefined> }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length)
    return <div className="text-xs text-muted-foreground">No inputs configured.</div>;
  return (
    <div className="flex flex-col gap-1.5" data-editor-control="inputs-display">
      {entries.map(([name, item]) => (
        <div
          className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-xs"
          key={name}
        >
          <span className="truncate text-muted-foreground">{name}</span>
          <code className="max-w-[65%] truncate text-foreground">{valueLabel(item)}</code>
        </div>
      ))}
    </div>
  );
}

export const InputsValues = ({
  value,
  onChange,
  readonly,
}: {
  value?: Record<string, IFlowValue | undefined>;
  onChange: (value: Record<string, IFlowValue | undefined>) => void;
  readonly?: boolean;
}) => {
  const entries = Object.entries(value ?? {});
  const [newName, setNewName] = useState('');
  const update = (name: string, next: IFlowValue) => onChange({ ...value, [name]: next });
  const remove = (name: string) => {
    const next = { ...value };
    delete next[name];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2" data-editor-control="inputs-values">
      {entries.map(([name, item]) => (
        <div className="flex flex-col gap-1 rounded-lg border border-border/70 p-2" key={name}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium">{name}</span>
            {!readonly && (
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => remove(name)}
                aria-label={`Remove input ${name}`}
              >
                <X />
              </Button>
            )}
          </div>
          <DynamicValueInput
            value={item}
            onChange={(next) => update(name, next)}
            readonly={readonly}
          />
        </div>
      ))}
      {!readonly && (
        <div className="flex gap-1.5">
          <Input
            aria-label="New input name"
            placeholder="Input name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={
              !newName.trim() || Object.prototype.hasOwnProperty.call(value ?? {}, newName.trim())
            }
            onClick={() => {
              const name = newName.trim();
              onChange({ ...value, [name]: { type: 'constant', content: '' } });
              setNewName('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
};

export function DisplayOutputs({
  value,
  displayFromScope,
}: {
  value?: IJsonSchema;
  displayFromScope?: boolean;
}) {
  const properties = Object.entries(value?.properties ?? {});
  if (!properties.length)
    return <div className="text-xs text-muted-foreground">No outputs configured.</div>;
  return (
    <div className="flex flex-col gap-1.5" data-editor-control="outputs-display">
      <div className="text-xs font-medium text-muted-foreground">
        {displayFromScope ? 'Outputs' : 'Schema'}
      </div>
      {properties.map(([name, property]) => (
        <div
          className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-xs"
          key={name}
        >
          <span className="truncate">{name}</span>
          <DisplaySchemaTag value={property} />
        </div>
      ))}
    </div>
  );
}

export function BatchVariableSelector({
  value,
  onChange,
  readonly,
  style,
  hasError,
}: {
  value?: string[];
  onChange: (value: string[]) => void;
  readonly?: boolean;
  style?: React.CSSProperties;
  hasError?: boolean;
}) {
  return (
    <Input
      aria-label="Loop input"
      className={cn(hasError && 'border-destructive')}
      style={style}
      value={fieldText(value)}
      disabled={readonly}
      placeholder="variable.items"
      onChange={(event) => onChange(pathValue(event.target.value))}
    />
  );
}

export function BatchOutputs({
  value,
  onChange,
  readonly,
  style,
  hasError,
}: {
  value?: Record<string, IFlowRefValue | undefined>;
  onChange: (value: Record<string, IFlowRefValue | undefined>) => void;
  readonly?: boolean;
  style?: React.CSSProperties;
  hasError?: boolean;
}) {
  const [newName, setNewName] = useState('');
  const entries = Object.entries(value ?? {});
  const trimmedName = newName.trim();
  const duplicateName = Boolean(
    trimmedName && Object.prototype.hasOwnProperty.call(value ?? {}, trimmedName)
  );
  return (
    <div
      className={cn('flex flex-col gap-1.5', hasError && 'rounded-lg ring-1 ring-destructive/40')}
      style={style}
    >
      {entries.map(([name, item]) => (
        <div className="flex items-center gap-1.5" key={name}>
          <span className="w-24 truncate text-xs">{name}</span>
          <Input
            value={fieldText(item?.content)}
            disabled={readonly}
            onChange={(event) =>
              onChange({
                ...value,
                [name]: { ...item, type: 'ref', content: pathValue(event.target.value) },
              })
            }
          />
        </div>
      ))}
      {!readonly && (
        <div className="flex gap-1.5">
          <Input
            placeholder="Output name"
            value={newName}
            aria-invalid={duplicateName || undefined}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!trimmedName || duplicateName}
            onClick={() => {
              if (!trimmedName || duplicateName) return;
              onChange({ ...value, [trimmedName]: { type: 'ref', content: [] } });
              setNewName('');
            }}
          >
            Add
          </Button>
        </div>
      )}
      {duplicateName && (
        <div className="text-xs text-destructive" role="alert">
          An output with this name already exists.
        </div>
      )}
    </div>
  );
}

const ASSIGN_OPERATORS = [
  { value: 'assign', label: 'Assign' },
  { value: 'declare', label: 'Declare' },
];

export function AssignRows({ name = 'assign', readonly }: { name?: string; readonly?: boolean }) {
  return (
    <Field<AssignValueType[]> name={name} defaultValue={[]}>
      {({ field }) => {
        const rows = field.value ?? [];
        return (
          <div className="flex flex-col gap-2" data-editor-control="assign-rows">
            {rows.map((row, index) => (
              <div
                className="flex flex-col gap-1.5 rounded-lg border border-border/70 p-2"
                key={index}
              >
                <div className="flex items-center gap-1.5">
                  <Select
                    value={row.operator}
                    disabled={readonly}
                    onChange={(event) => {
                      const next = [...rows] as AssignValueType[];
                      next[index] = {
                        ...row,
                        operator: event.currentTarget.value as 'assign' | 'declare',
                      } as AssignValueType;
                      field.onChange(next);
                    }}
                  >
                    {ASSIGN_OPERATORS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={readonly}
                    onClick={() => field.onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                    aria-label="Remove assignment"
                  >
                    <X />
                  </Button>
                </div>
                {row.operator === 'declare' ? (
                  <Input
                    value={row.left ?? ''}
                    disabled={readonly}
                    placeholder="variable name"
                    onChange={(event) => {
                      const next = [...rows] as AssignValueType[];
                      next[index] = { ...row, left: event.target.value } as AssignValueType;
                      field.onChange(next);
                    }}
                  />
                ) : (
                  <Input
                    value={fieldText(row.left?.content)}
                    disabled={readonly}
                    placeholder="target.variable"
                    onChange={(event) => {
                      const next = [...rows] as AssignValueType[];
                      next[index] = {
                        ...row,
                        left: { type: 'ref', content: pathValue(event.target.value) },
                      } as AssignValueType;
                      field.onChange(next);
                    }}
                  />
                )}
                <DynamicValueInput
                  value={row.right}
                  readonly={readonly}
                  onChange={(right) => {
                    const next = [...rows] as AssignValueType[];
                    next[index] = { ...row, right } as AssignValueType;
                    field.onChange(next);
                  }}
                />
              </div>
            ))}
            {!readonly && (
              <Button
                className="w-fit"
                size="sm"
                variant="outline"
                onClick={() =>
                  field.onChange([
                    ...rows,
                    {
                      operator: 'assign',
                      left: { type: 'ref', content: [] },
                      right: { type: 'constant', content: '' },
                    },
                  ])
                }
              >
                <Plus data-icon="inline-start" />
                Add assignment
              </Button>
            )}
          </div>
        );
      }}
    </Field>
  );
}

export function ConditionRow({
  value,
  onChange,
  readonly,
  ruleConfig,
  style,
}: {
  value?: ConditionRowValueType;
  onChange: (value: ConditionRowValueType) => void;
  readonly?: boolean;
  ruleConfig?: {
    ops?: ConditionOpConfigs;
    rules?: Record<string, IConditionRule>;
  };
  style?: React.CSSProperties;
}) {
  const { left, operator, right } = value ?? {};
  const available = useScopeAvailable();
  const variable = useMemo(
    () => (left ? available.getByKeyPath(left.content) : undefined),
    [available, left]
  );
  const leftSchema = useMemo(
    () =>
      variable?.type ? JsonSchemaUtils.astToSchema(variable.type, { drilldown: false }) : undefined,
    [variable?.type?.hash]
  );
  const opConfigs = (ruleConfig?.ops ?? conditionRowRuleConfig.ops) as ConditionOpConfigs;
  const rules = (ruleConfig?.rules ?? conditionRowRuleConfig.rules) as Record<
    string,
    IConditionRule
  >;
  const rule = leftSchema ? rules?.[leftSchema.type as string] : undefined;
  const opOptions = Object.keys(rule ?? {}).filter((key) => opConfigs[key]);
  const config = operator ? opConfigs[operator] : undefined;
  const targetType = operator ? rule?.[operator] ?? null : null;
  const targetSchema =
    typeof targetType === 'string'
      ? { type: targetType, extra: { weak: true } }
      : targetType ?? undefined;
  const previousTargetType = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (operator && rule && !opOptions.includes(operator)) {
      onChange({ ...value, operator: undefined });
    }
  }, [onChange, opOptions, operator, rule, value]);

  useEffect(() => {
    const currentTargetType = typeof targetType === 'string' ? targetType : targetType?.type;
    if (
      previousTargetType.current !== undefined &&
      previousTargetType.current !== currentTargetType
    ) {
      onChange({ ...value, right: undefined });
    }
    previousTargetType.current = currentTargetType;
  }, [onChange, targetType, value]);

  const needsRight = Boolean(targetSchema);
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] gap-1.5"
      style={style}
      data-editor-control="condition-row"
    >
      <Input
        aria-label="Condition variable"
        value={fieldText(left?.content)}
        disabled={readonly}
        placeholder="variable.path"
        onChange={(event) =>
          onChange({
            ...value,
            left: { ...(value?.left ?? {}), type: 'ref', content: pathValue(event.target.value) },
          })
        }
      />
      <Select
        aria-label="Condition operator"
        value={operator}
        disabled={readonly || !rule}
        onChange={(event) => {
          onChange({
            ...value,
            operator: event.currentTarget.value,
          });
        }}
      >
        {opOptions.map((key) => (
          <option key={key} value={key}>
            {opConfigs[key].label}
          </option>
        ))}
      </Select>
      {needsRight ? (
        <DynamicValueInput
          value={right}
          readonly={readonly || !rule}
          schema={targetSchema}
          onChange={(right) =>
            onChange({ ...value, right: right as ConditionRowValueType['right'] })
          }
        />
      ) : (
        <div className="flex h-8 items-center rounded-lg bg-muted px-2 text-xs text-muted-foreground">
          {config?.rightDisplay}
        </div>
      )}
    </div>
  );
}

export function useVariableTree() {
  const variables = useAvailableVariables();

  return useMemo(() => {
    type VariableField = {
      key: string;
      type?: { properties?: VariableField[] };
      meta?: { title?: string };
    };
    type VariableTreeNode = {
      key: string;
      label: string;
      value: string;
      keyPath: string[];
      children?: VariableTreeNode[];
      rootMeta?: VariableField['meta'];
      isRoot?: boolean;
    };

    const renderVariable = (
      variable: VariableField,
      parentFields: VariableField[] = []
    ): VariableTreeNode | null => {
      if (!variable?.type) return null;
      const children = variable.type.properties
        ?.map((property) => renderVariable(property, [...parentFields, variable]))
        .filter(Boolean) as VariableTreeNode[] | undefined;
      const keyPath = [...parentFields.map((field) => field.key), variable.key];
      const key = keyPath.join('.');
      return {
        key,
        label: variable.meta?.title || variable.key,
        value: key,
        keyPath,
        children: children?.length ? children : undefined,
        rootMeta: parentFields[0]?.meta || variable.meta,
        isRoot: parentFields.length === 0,
      };
    };

    return variables
      .slice()
      .reverse()
      .map((variable) => renderVariable(variable as VariableField))
      .filter(Boolean) as VariableTreeNode[];
  }, [variables]);
}

type VariableTreeNode = ReturnType<typeof useVariableTree>[number];

type VariableTreeKeyboardNode = {
  key: string;
  value: string;
  children?: VariableTreeKeyboardNode[];
};

type VisibleVariableTreeNode = {
  node: VariableTreeKeyboardNode;
  parentKey?: string;
};

function getVariableTreeBranchKeys(nodes: VariableTreeKeyboardNode[]): Set<string> {
  return new Set(
    nodes.flatMap((node) => [
      ...(node.children?.length ? [node.key] : []),
      ...(node.children ? [...getVariableTreeBranchKeys(node.children)] : []),
    ])
  );
}

function getVisibleVariableTreeNodes(
  nodes: VariableTreeKeyboardNode[],
  expanded: Set<string>,
  parentKey?: string
): VisibleVariableTreeNode[] {
  return nodes.flatMap((node) => [
    { node, parentKey },
    ...(node.children && expanded.has(node.key)
      ? getVisibleVariableTreeNodes(node.children, expanded, node.key)
      : []),
  ]);
}

export function useVariableTreeKeyboard(
  treeData: VariableTreeKeyboardNode[],
  onSelect?: (value: string) => void
) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(treeData.filter((node) => node.children?.length).map((node) => node.key))
  );
  const visibleNodes = useMemo(
    () => getVisibleVariableTreeNodes(treeData, expanded),
    [expanded, treeData]
  );
  const treeSignature = useMemo(
    () => [...getVariableTreeBranchKeys(treeData)].sort().join('|'),
    [treeData]
  );
  const previousTreeSignature = useRef(treeSignature);
  const previousBranchKeys = useRef(getVariableTreeBranchKeys(treeData));

  useEffect(() => {
    if (previousTreeSignature.current === treeSignature) return;
    previousTreeSignature.current = treeSignature;
    const branchKeys = getVariableTreeBranchKeys(treeData);
    const newBranchKeys = [...branchKeys].filter((key) => !previousBranchKeys.current.has(key));
    previousBranchKeys.current = branchKeys;
    setExpanded((current) => {
      const next = new Set([...current].filter((key) => branchKeys.has(key)));
      for (const key of newBranchKeys) next.add(key);
      return next;
    });
  }, [treeData, treeSignature]);

  const onToggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const focusItem = (key: string) => {
    const item = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-variable-tree-focus]') ?? []
    ).find((element) => element.dataset.variableTreeFocus === key);
    item?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!visibleNodes.length) return;

    const currentElement = event.target instanceof HTMLElement ? event.target : null;
    const currentKey =
      currentElement?.closest<HTMLElement>('[data-variable-tree-item]')?.dataset.variableTreeItem ??
      visibleNodes[0].node.key;
    const currentIndex = Math.max(
      0,
      visibleNodes.findIndex(({ node }) => node.key === currentKey)
    );
    const current = visibleNodes[currentIndex];
    const hasChildren = Boolean(current.node.children?.length);
    const isExpanded = expanded.has(current.node.key);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(visibleNodes[Math.min(currentIndex + 1, visibleNodes.length - 1)].node.key);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(visibleNodes[Math.max(currentIndex - 1, 0)].node.key);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(visibleNodes[0].node.key);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(visibleNodes[visibleNodes.length - 1].node.key);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (hasChildren && !isExpanded) {
        onToggle(current.node.key);
      } else if (hasChildren && visibleNodes[currentIndex + 1]?.parentKey === current.node.key) {
        focusItem(visibleNodes[currentIndex + 1].node.key);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && isExpanded) onToggle(current.node.key);
      else if (current.parentKey) focusItem(current.parentKey);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (hasChildren) onToggle(current.node.key);
      else onSelect?.(current.node.value);
    }
  };

  return { treeRef, expanded, onToggle, onKeyDown };
}

function VariableTreeItem({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  onKeyDown,
}: {
  node: VariableTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expanded.has(node.key);

  return (
    <div
      role="treeitem"
      data-variable-tree-item={node.key}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div className="flex items-center gap-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
            onClick={() => onToggle(node.key)}
          >
            {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        ) : (
          <span className="size-7 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          tabIndex={-1}
          data-variable-tree-focus={node.key}
          data-variable-tree-leaf={hasChildren ? undefined : 'true'}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          onKeyDown={(event) => {
            onKeyDown(event);
            event.stopPropagation();
          }}
          onClick={() => onSelect(node.value)}
        >
          <span className="min-w-0 flex-1 truncate" title={node.value}>
            {node.label}
          </span>
          <code className="max-w-[58%] truncate text-xs text-muted-foreground">{node.value}</code>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <div role="group">
          {node.children?.map((child) => (
            <VariableTreeItem
              key={child.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onKeyDown={onKeyDown}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VariableTree({
  treeData,
  onSelect,
}: {
  treeData: VariableTreeNode[];
  onSelect: (value: string) => void;
}) {
  const { treeRef, expanded, onToggle, onKeyDown } = useVariableTreeKeyboard(treeData, onSelect);

  if (!treeData.length) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">No variables available.</div>;
  }

  return (
    <div
      ref={treeRef}
      className="max-h-64 overflow-y-auto"
      role="tree"
      aria-label="Available variables"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {treeData.map((node) => (
        <VariableTreeItem
          key={node.key}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          onKeyDown={onKeyDown}
        />
      ))}
    </div>
  );
}

function VariablePicker({
  value,
  onChange,
  readonly,
  hasError,
}: {
  value?: string[];
  onChange: (value?: string[]) => void;
  readonly?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const treeData = useVariableTree();
  const label = value?.length ? value.join('.') : 'Select variable';

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Select variable"
            disabled={readonly}
            aria-expanded={open}
            className={cn('w-full justify-between font-normal', hasError && 'border-destructive')}
          >
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        }
      />
      <PopoverContent
        aria-label="Variable selector"
        side="bottom"
        align="start"
        className="w-[min(360px,calc(100vw-2rem))] p-1"
        positionerClassName="isolate z-[1200]"
      >
        <PopoverTitle className="sr-only">Variable selector</PopoverTitle>
        <VariableTree
          treeData={treeData}
          onSelect={(next) => {
            onChange(next.split('.'));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function renderFieldErrors(errors?: FieldErrorLike[]) {
  if (!errors?.length) return null;
  return (
    <div className="text-xs text-destructive" role="alert">
      {errors.map((error, index) => (
        <div key={index}>{error.message}</div>
      ))}
    </div>
  );
}
