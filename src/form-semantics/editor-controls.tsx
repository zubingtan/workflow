import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import CodeMirror, {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import {
  JsonSchemaUtils,
  useTypeManager,
  type JsonSchemaTypeManager,
} from '@flowgram.ai/json-schema';
import { Field } from '@flowgram.ai/free-layout-editor';
import {
  PrivateScopeProvider,
  useAvailableVariables,
  useCurrentScope,
  useRefresh,
  useScopeAvailable,
} from '@flowgram.ai/editor';
import { languages, transformerCreator } from '@coze-editor/preset-code';
import { mixLanguages } from '@coze-editor/extensions';
import { typescript as cozeTypescript } from '@coze-editor/code-language-typescript';
import {
  languageIdFacet,
  textDocumentField,
  transformerFacet,
  uriFacet,
} from '@coze-editor/code-language-shared';
import { json as cozeJson, type Text as CozeText } from '@coze-editor/code-language-json';

import { useTheme } from '@/theme';
import { cn } from '@/lib/utils';
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
  IInputsValues,
  IJsonSchema,
} from './types';
import { FlowValueUtils } from './flow-value.mjs';
import { conditionRowRuleConfig } from './condition.mjs';

type VariableSelectorContextValue = {
  includeSchema?: IJsonSchema | IJsonSchema[];
  excludeSchema?: IJsonSchema | IJsonSchema[];
  skipVariable?: (variable: VariableFieldLike) => boolean;
};

const VariableSelectorContext = createContext<VariableSelectorContextValue>({});

export function useVariableSelectorContext() {
  return useContext(VariableSelectorContext);
}

export function VariableSelectorProvider({
  children,
  includeSchema,
  excludeSchema,
  skipVariable,
}: VariableSelectorContextValue & { children: React.ReactNode }) {
  const context = useMemo(
    () => ({ includeSchema, excludeSchema, skipVariable }),
    [excludeSchema, includeSchema, skipVariable]
  );
  return (
    <VariableSelectorContext.Provider value={context}>{children}</VariableSelectorContext.Provider>
  );
}

type FieldErrorLike = { message?: string };

const CONTROL_CLASS =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50';

const jsonVariableTransformer = transformerCreator((text: CozeText) => {
  const source = text.toString();
  const matches = [...source.matchAll(/\{\{([^}]*)\}\}/g)];
  for (const match of matches) {
    if (match.index !== undefined) {
      text.replaceRange(match.index, match.index + match[0].length, 'null');
    }
  }
  return text;
});

if (!languages.get('json')) {
  languages.register('json', {
    // Keep interpolation out of JSON syntax diagnostics while preserving the
    // original source through the language-service mapping.
    language: mixLanguages({ outerLanguage: cozeJson.language }),
    languageService: cozeJson.languageService,
  });
}

let typeScriptLanguageInitialized = false;
const typeScriptParamsSchemas = new Map<string, IJsonSchema>();
let typeScriptCompletionPatched = false;

function paramsCompletionItems(schema: IJsonSchema, path: string[]) {
  let current: IJsonSchema | undefined = schema;
  for (const segment of path) {
    if (!current) return [];
    current = current.properties?.[segment];
  }
  if (!current) return [];
  return Object.keys(current.properties ?? {}).map((label) => ({
    label,
    kind: 10 as const, // vscode-languageserver CompletionItemKind.Property
  }));
}

function ensureTypeScriptLanguage() {
  if (!languages.get('typescript')) {
    languages.register('typescript', cozeTypescript);
  }
  if (typeScriptLanguageInitialized) return;
  typeScriptLanguageInitialized = true;
  if (!typeScriptCompletionPatched) {
    const languageService = cozeTypescript.languageService;
    const nativeCompletion = languageService.doComplete?.bind(languageService);
    languageService.doComplete = async (context) => {
      const schema = typeScriptParamsSchemas.get(context.textDocument.uri);
      const beforeCursor = context.textDocument.getText().slice(0, context.offset);
      const match = /\bparams((?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/.exec(beforeCursor);
      if (schema && match) {
        const path = match[1]
          .split('.')
          .filter(Boolean)
          .map((segment) => segment.trim());
        const query = match[2] ?? '';
        const from = context.offset - query.length;
        const items = paramsCompletionItems(schema, path).map((item) => ({
          ...item,
          textEdit: {
            range: {
              start: context.textDocument.positionAt(from),
              end: context.textDocument.positionAt(context.offset),
            },
            newText: item.label,
          },
        }));
        if (items.length) return { isIncomplete: false, items };
      }
      try {
        return nativeCompletion ? await nativeCompletion(context) : null;
      } catch {
        // A completion provider is optional. A malformed virtual document must
        // not break editing or the schema-backed params completion above.
        return null;
      }
    };
    typeScriptCompletionPatched = true;
  }
  const worker = new Worker(
    new URL('@flowgram.ai/coze-editor/language-typescript/worker', import.meta.url),
    { type: 'module' }
  );
  cozeTypescript.languageService.initialize(worker, {
    compilerOptions: {
      lib: ['es2015', 'dom'],
      noImplicitAny: false,
    },
  });
}

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
    case 'map':
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

/** Keep the selector contract used by the former form editor: number refs accept
 * integer variables, while every other declared schema is a weak match. */
function includeSchemaForVariablePicker(
  schema?: IJsonSchema
): IJsonSchema | IJsonSchema[] | undefined {
  if (!schema) return undefined;
  if (schema.type === 'number') return [schema, { type: 'integer' }];
  return { ...schema, extra: { weak: true, ...schema.extra } };
}

function dateTimeInputValue(value: string): string {
  return value
    .replace(/Z$/, '')
    .replace(/\.\d{3}$/, '')
    .slice(0, 16);
}

function dateTimeFlowValue(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
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
  if (mode === 'constant') {
    const previousSchema = previous?.type === 'constant' ? previous.schema : undefined;
    return {
      ...base,
      type: 'constant',
      content: parseConstant(text, schema ?? previousSchema),
      schema: schema ?? previousSchema ?? { type: 'string' },
    } as IFlowValue;
  }
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
  const effectiveSchema = schema ?? (value?.type === 'constant' ? value.schema : undefined);
  const isBoolean = mode === 'constant' && effectiveSchema?.type === 'boolean';
  const isEnum = mode === 'constant' && Boolean(effectiveSchema?.enum);
  const isStructured =
    mode === 'constant' && ['array', 'object', 'map'].includes(effectiveSchema?.type ?? '');
  const isDateTime = mode === 'constant' && effectiveSchema?.type === 'date-time';
  const text = flowValueToText(value);

  return (
    <div className="flex min-w-0 flex-1 gap-1.5" data-editor-control="dynamic-value">
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
          includeSchema={includeSchemaForVariablePicker(effectiveSchema)}
          onChange={(next) =>
            onChange({
              ...(next
                ? { ...(value ?? {}), type: 'ref', content: next }
                : updateFlowValue(value, 'constant', '', effectiveSchema)),
            } as IFlowValue)
          }
          readonly={readonly}
          hasError={hasError}
        />
      ) : isEnum ? (
        <Select
          aria-label="Enum value"
          aria-invalid={hasError || undefined}
          className={cn(CONTROL_CLASS, 'min-w-0 flex-1', hasError && 'border-destructive')}
          value={text}
          disabled={readonly}
          onChange={(event) =>
            onChange(updateFlowValue(value, 'constant', event.currentTarget.value, effectiveSchema))
          }
        >
          {(effectiveSchema?.enum ?? []).map((item) => (
            <option key={String(item)} value={String(item)}>
              {String(item)}
            </option>
          ))}
        </Select>
      ) : isBoolean ? (
        <Select
          aria-label="Boolean value"
          aria-invalid={hasError || undefined}
          className={cn(CONTROL_CLASS, 'min-w-0 flex-1', hasError && 'border-destructive')}
          value={text === 'true' ? 'true' : 'false'}
          disabled={readonly}
          onChange={(event) =>
            onChange(updateFlowValue(value, 'constant', event.currentTarget.value, schema))
          }
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      ) : isStructured ? (
        <VariableCodeEditor
          kind="json"
          ariaLabel="Structured value"
          value={text}
          readonly={readonly}
          hasError={hasError}
          language="json"
          enableVariables={false}
          onChange={(next) => onChange(updateFlowValue(value, 'constant', next, effectiveSchema))}
        />
      ) : isDateTime ? (
        <Input
          aria-label="Date and time value"
          aria-invalid={hasError || undefined}
          className="min-w-0 flex-1"
          type="datetime-local"
          value={dateTimeInputValue(text)}
          disabled={readonly}
          onChange={(event) =>
            onChange(
              updateFlowValue(
                value,
                'constant',
                dateTimeFlowValue(event.target.value),
                effectiveSchema
              )
            )
          }
        />
      ) : (
        <Input
          aria-invalid={hasError || undefined}
          className={cn('min-w-0 flex-1', hasError && 'border-destructive')}
          type={
            mode === 'constant' &&
            (effectiveSchema?.type === 'number' || effectiveSchema?.type === 'integer')
              ? 'number'
              : 'text'
          }
          value={text}
          disabled={readonly}
          onChange={(event) =>
            onChange(updateFlowValue(value, mode, event.target.value, effectiveSchema))
          }
        />
      )}
    </div>
  );
}

class VariableChipWidget extends WidgetType {
  constructor(
    private readonly variable: string,
    private readonly label: string,
    private readonly unknown: boolean,
    private readonly icon?: string
  ) {
    super();
  }

  toDOM() {
    const chip = document.createElement('span');
    chip.className = 'cm-variable-chip';
    chip.dataset.variableChip = this.variable;
    if (this.unknown) chip.dataset.variableUnknown = 'true';
    chip.title = `{{${this.variable}}}`;
    if (this.icon) {
      const icon = document.createElement('img');
      icon.src = this.icon;
      icon.alt = '';
      icon.width = 12;
      icon.height = 12;
      icon.className = 'mr-1 inline-block align-text-bottom';
      chip.append(icon);
    }
    const text = document.createElement('span');
    text.textContent = this.label;
    chip.append(text);
    return chip;
  }

  eq(other: VariableChipWidget) {
    return (
      this.variable === other.variable &&
      this.label === other.label &&
      this.unknown === other.unknown &&
      this.icon === other.icon
    );
  }

  ignoreEvent() {
    return false;
  }
}

type VariableChipTreeNode = {
  value: string;
  label: string;
  keyPath: string[];
  rootMeta?: { title?: string; icon?: string | React.ReactNode };
  children?: VariableChipTreeNode[];
};

function createVariableChipExtension(treeData: VariableChipTreeNode[]) {
  const variables = new Map<string, VariableChipTreeNode>();
  const collect = (nodes: VariableChipTreeNode[]) => {
    for (const node of nodes) {
      variables.set(node.value, node);
      if (node.children) collect(node.children);
    }
  };
  collect(treeData);
  const matcher = new MatchDecorator({
    regexp: /\{\{([^{}]+)\}\}/g,
    decoration: (match) => {
      const variable = match[1]?.trim() ?? '';
      const node = variables.get(variable);
      const rootTitle = node?.rootMeta?.title;
      const label = node
        ? node.keyPath.length > 1 && rootTitle
          ? `${rootTitle} - ${node.label}`
          : node.label
        : variable;
      return Decoration.replace({
        widget: new VariableChipWidget(
          variable,
          label,
          !node,
          typeof node?.rootMeta?.icon === 'string' ? node.rootMeta.icon : undefined
        ),
        inclusive: false,
      });
    },
  });

  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;

      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = matcher.updateDeco(update, this.decorations);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    }
  );
}

type VariableEditorKind = 'prompt' | 'json';

function VariableCodeEditor({
  value,
  onChange,
  readonly,
  placeholder,
  hasError,
  style,
  kind,
  language,
  ariaLabel,
  enableVariables = true,
  paramsSchema,
}: {
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  placeholder?: string;
  hasError?: boolean;
  style?: React.CSSProperties;
  kind?: VariableEditorKind;
  language?: 'json' | 'typescript';
  ariaLabel: string;
  enableVariables?: boolean;
  paramsSchema?: IJsonSchema;
}) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const editorId = useId();
  // `vscode-uri` resolves `workflow://typescript` to an authority-only URI,
  // whose `fsPath` is empty. The TypeScript worker then receives an empty
  // source-file name and rejects every completion request. Keep each editor
  // document on a valid, stable path so the worker can synchronize it.
  const documentUri = useMemo(
    () =>
      `workflow:///editor/${editorId.replace(/[^a-zA-Z0-9_-]/g, '')}.${
        language === 'typescript' ? 'ts' : language ?? 'txt'
      }`,
    [editorId, language]
  );
  const [open, setOpen] = useState(false);
  const [chip, setChip] = useState<{ variable: string; element: HTMLElement } | null>(null);
  const insertionGuardRef = useRef<string | null>(null);
  const treeData = useVariableTree();
  const [typeScriptReady, setTypeScriptReady] = useState(
    () => language !== 'typescript' || Boolean(languages.get('typescript'))
  );
  const variableChipExtension = useMemo(
    () => (enableVariables ? createVariableChipExtension(treeData) : []),
    [enableVariables, treeData]
  );
  useEffect(() => {
    if (language !== 'typescript' || !paramsSchema) return;
    typeScriptParamsSchemas.set(documentUri, paramsSchema);
    return () => {
      typeScriptParamsSchemas.delete(documentUri);
    };
  }, [documentUri, language, paramsSchema]);

  const triggerMatch = (nextText: string, nextCursor: number) => {
    if (kind === 'prompt') return nextText.slice(0, nextCursor).match(/(?:@|\{\{?)[^{}@]*$/);
    return nextText.slice(0, nextCursor).match(/(?:@|\{\{)[^{}@]*$/);
  };

  const updateAnchor = (view: EditorView, position: number) => {
    const anchor = anchorRef.current;
    const container = editorRef.current;
    if (!anchor || !container) return;
    const coords = view.coordsAtPos(position);
    const containerRect = container.getBoundingClientRect();
    if (!coords) return;
    anchor.style.left = `${coords.left - containerRect.left}px`;
    anchor.style.top = `${coords.bottom - containerRect.top}px`;
  };

  const updateOpenState = (view: EditorView) => {
    if (!enableVariables || readonly) {
      setOpen(false);
      return;
    }
    const suggestionSelector = `[data-variable-suggestions-for="${editorId}"]`;
    if (!view.hasFocus && !document.activeElement?.closest(suggestionSelector)) {
      setOpen(false);
      return;
    }
    const position = view.state.selection.main.head;
    updateAnchor(view, position);
    setOpen(Boolean(triggerMatch(view.state.doc.toString(), position)));
  };

  useEffect(() => {
    if (!open && !chip) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        editorRef.current?.contains(target) ||
        target.closest('[data-variable-suggestions]') ||
        target.closest('[data-variable-chip-popover]')
      )
        return;
      setOpen(false);
      setChip(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [chip, open]);

  useEffect(() => {
    if (language !== 'typescript') {
      setTypeScriptReady(true);
      return;
    }
    ensureTypeScriptLanguage();
    setTypeScriptReady(true);
  }, [language]);

  useEffect(() => {
    const content = editorViewRef.current?.contentDOM;
    if (!content) return;
    if (hasError) content.setAttribute('aria-invalid', 'true');
    else content.removeAttribute('aria-invalid');
  }, [hasError]);

  const focusSuggestion = (last: boolean) => {
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-variable-suggestions-for="${editorId}"] [data-variable-tree-focus]`
      )
    );
    (last ? items.at(-1) : items[0])?.focus();
  };

  const insertVariable = (variable: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    if (insertionGuardRef.current === variable) return;
    insertionGuardRef.current = variable;
    queueMicrotask(() => {
      if (insertionGuardRef.current === variable) insertionGuardRef.current = null;
    });
    const currentText = view.state.doc.toString();
    const currentCursor = view.state.selection.main.head;
    const inserted = `{{${variable}}}`;
    if (
      currentText.slice(Math.max(0, currentCursor - inserted.length), currentCursor) === inserted
    ) {
      setOpen(false);
      view.focus();
      return;
    }
    const match = triggerMatch(currentText, currentCursor);
    let start = match ? currentCursor - match[0].length : currentCursor;
    while (start > 0 && currentText[start - 1] === '{') start -= 1;
    let end = currentCursor;
    while (currentText[end] === '}') end += 1;
    view.dispatch({
      changes: { from: start, to: end, insert: inserted },
      selection: { anchor: start + inserted.length },
    });
    setOpen(false);
    view.focus();
  };

  const languageServiceExtension = language
    ? [
        languageIdFacet.of(language),
        uriFacet.of(documentUri),
        textDocumentField,
        ...(language === 'json'
          ? [transformerFacet.of(jsonVariableTransformer), languages.getExtension('json')]
          : typeScriptReady
          ? [languages.getExtension('typescript'), cozeTypescript.extensions]
          : []),
      ]
    : [];

  return (
    <div
      ref={editorRef}
      className="relative min-w-0 flex-1"
      style={style}
      onMouseOver={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[data-variable-chip]');
        const variable = element?.dataset.variableChip;
        if (element && variable) setChip({ variable, element });
      }}
      onClick={(event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>('[data-variable-chip]');
        const variable = element?.dataset.variableChip;
        if (element && variable) setChip({ variable, element });
      }}
      onMouseLeave={(event) => {
        const related = event.relatedTarget;
        if (!(related instanceof Element) || !related.closest('[data-variable-chip-popover]')) {
          setChip(null);
        }
      }}
    >
      <CodeMirror
        data-template-editor={kind === 'prompt' ? 'true' : undefined}
        data-json-editor={kind === 'json' ? 'true' : undefined}
        data-code-editor={language === 'typescript' ? 'true' : undefined}
        data-editor-theme={language ? resolvedTheme : undefined}
        className={cn(
          'min-h-24 overflow-hidden rounded-lg border border-input bg-background text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
          '[&_.cm-editor]:min-h-24 [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none',
          '[&_.cm-scroller]:min-h-24 [&_.cm-scroller]:overflow-auto',
          '[&_.cm-content]:min-h-24 [&_.cm-content]:p-2.5 [&_.cm-content]:font-mono [&_.cm-content]:text-xs',
          '[&_.cm-line]:leading-5 [&_.cm-placeholder]:text-muted-foreground',
          kind === 'prompt' && '[&_.cm-line]:leading-7',
          hasError && 'border-destructive focus-within:border-destructive',
          kind === 'json' && 'min-h-28',
          language === 'typescript' &&
            'h-44 bg-muted/40 [&_.cm-editor]:h-full [&_.cm-scroller]:h-full [&_.cm-content]:min-h-full'
        )}
        value={value}
        placeholder={placeholder}
        theme={resolvedTheme}
        basicSetup={{ lineNumbers: false, foldGutter: false, autocompletion: Boolean(language) }}
        editable={!readonly}
        readOnly={readonly}
        extensions={[
          languageServiceExtension,
          variableChipExtension,
          kind === 'prompt' ? EditorView.lineWrapping : [],
        ]}
        onCreateEditor={(view) => {
          editorViewRef.current = view;
          view.contentDOM.setAttribute('aria-label', ariaLabel);
          if (enableVariables) {
            view.contentDOM.setAttribute('role', 'combobox');
            view.contentDOM.setAttribute('aria-autocomplete', 'list');
          }
          if (hasError) view.contentDOM.setAttribute('aria-invalid', 'true');
        }}
        onUpdate={(update) => {
          if (
            enableVariables &&
            (update.docChanged || update.selectionSet || update.focusChanged)
          ) {
            updateOpenState(update.view);
          }
        }}
        onChange={onChange}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setChip(null);
            editorViewRef.current?.focus();
            return;
          }
          if (!open || !enableVariables) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            focusSuggestion(event.key === 'ArrowUp');
          }
        }}
      />
      <span
        ref={anchorRef}
        aria-hidden="true"
        className="pointer-events-none absolute size-px"
        style={{ left: 0, top: 0 }}
      />
      {enableVariables && (
        <Popover open={open} onOpenChange={setOpen} modal={false}>
          <PopoverContent
            anchor={anchorRef.current ?? undefined}
            initialFocus={false}
            finalFocus={false}
            aria-label="Variable suggestions"
            data-variable-suggestions="true"
            data-variable-suggestions-for={editorId}
            side="bottom"
            align="start"
            className="w-[min(360px,calc(100vw-2rem))] p-1"
            positionerClassName="isolate z-[1200]"
            onKeyDownCapture={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
                editorViewRef.current?.focus();
              }
            }}
          >
            <PopoverTitle className="sr-only">Variable suggestions</PopoverTitle>
            <VariableTree treeData={treeData} onSelect={(node) => insertVariable(node.value)} />
          </PopoverContent>
        </Popover>
      )}
      <Popover
        open={Boolean(chip)}
        onOpenChange={(nextOpen) => !nextOpen && setChip(null)}
        modal={false}
      >
        <PopoverContent
          anchor={chip?.element}
          data-variable-chip-popover="true"
          className="w-auto min-w-48 max-w-80 p-2"
          side="top"
          align="start"
          onMouseLeave={() => setChip(null)}
        >
          <PopoverTitle className="sr-only">Variable details</PopoverTitle>
          {(() => {
            const selected = chip
              ? findVariableTreeNodeByValue(treeData, chip.variable)
              : undefined;
            return selected ? (
              <div className="flex flex-col gap-1 text-xs">
                <div className="font-medium">
                  {selected.rootMeta?.title ?? selected.label}
                  {!selected.isRoot && selected.rootMeta?.title ? ` - ${selected.label}` : ''}
                </div>
                <code className="truncate text-muted-foreground">{chip?.variable}</code>
              </div>
            ) : (
              <div className="flex flex-col gap-1 text-xs text-amber-600 dark:text-amber-300">
                <div className="font-medium">Undefined variable</div>
                <code className="truncate">{chip?.variable}</code>
              </div>
            );
          })()}
        </PopoverContent>
      </Popover>
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
  return (
    <VariableCodeEditor
      kind="prompt"
      ariaLabel="Template value"
      value={flowValueToText(value)}
      placeholder={placeholder ?? 'Write text or use {{variable.path}}'}
      readonly={readonly}
      hasError={hasError}
      style={style}
      onChange={(nextText) => onChange({ ...(value ?? {}), type: 'template', content: nextText })}
    />
  );
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
    <VariableCodeEditor
      kind="json"
      language="json"
      ariaLabel="JSON value"
      value={value ?? ''}
      placeholder={placeholder ?? activeLinePlaceholder ?? '{\n  "key": "value"\n}'}
      readonly={readonly}
      onChange={onChange}
    />
  );
}

export function TypeScriptCodeEditor({
  value,
  onChange,
  readonly,
  paramsSchema,
}: {
  value?: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  paramsSchema?: IJsonSchema;
}) {
  return (
    <VariableCodeEditor
      language="typescript"
      ariaLabel="Code"
      value={value ?? ''}
      readonly={readonly}
      enableVariables={false}
      paramsSchema={paramsSchema}
      onChange={onChange}
    />
  );
}

function schemaPropertyType(property?: IJsonSchema): string {
  if (property?.enum) return 'enum';
  if (property?.type === 'string' && property.format === 'date-time') return 'date-time';
  return typeof property?.type === 'string' ? property.type : 'string';
}

const SCHEMA_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'map',
  'enum',
  'date-time',
] as const;

function schemaTypeOptions(value?: IJsonSchema): string[] {
  const current = schemaPropertyType(value);
  return SCHEMA_TYPES.includes(current as (typeof SCHEMA_TYPES)[number])
    ? [...SCHEMA_TYPES]
    : [...SCHEMA_TYPES, current];
}

function schemaDefaultForType(type: string): unknown {
  if (type === 'object') return {};
  if (type === 'map') return {};
  if (type === 'array') return [];
  if (type === 'enum') return '';
  if (type === 'date-time') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  return '';
}

function schemaDefaultText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseSchemaDefault(text: string, schema: IJsonSchema): unknown {
  if (schemaPropertyType(schema) === 'boolean') return text === 'true';
  if (schemaPropertyType(schema) === 'number' || schemaPropertyType(schema) === 'integer') {
    return text === '' ? undefined : Number(text);
  }
  if (
    schemaPropertyType(schema) === 'array' ||
    schemaPropertyType(schema) === 'object' ||
    schemaPropertyType(schema) === 'map'
  ) {
    try {
      return JSON.parse(text);
    } catch {
      return schema.default;
    }
  }
  return text;
}

function schemaWithType(value: IJsonSchema | undefined, type: string): IJsonSchema {
  const previousType = schemaPropertyType(value);
  const next: IJsonSchema = { ...value, type };
  if (type === 'enum') {
    next.type = typeof value?.type === 'string' && value.type !== 'enum' ? value.type : 'string';
    next.enum = next.enum ?? [''];
  } else {
    delete next.enum;
  }
  if (type === 'date-time') {
    next.type = 'date-time';
    next.format = 'date-time';
  } else if (next.format === 'date-time') {
    delete next.format;
  }
  if (type === 'object' && !next.properties) next.properties = {};
  if (type === 'array' && !next.items) next.items = { type: 'string' };
  if (type === 'map' && !next.additionalProperties) {
    next.additionalProperties = next.items ?? { type: 'string' };
  }
  if (previousType !== type || next.default === undefined) {
    next.default = schemaDefaultForType(type);
  }
  return next;
}

function schemaChild(value: IJsonSchema, type: string): IJsonSchema {
  return type === 'map'
    ? value.additionalProperties ?? value.items ?? { type: 'string' }
    : value.items ?? { type: 'string' };
}

function SchemaTypeSelect({
  value,
  label,
  onChange,
  readonly,
}: {
  value: IJsonSchema;
  label: string;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
}) {
  const type = schemaPropertyType(value);
  return (
    <Select
      aria-label={label}
      value={type}
      disabled={readonly}
      onChange={(event) => onChange(schemaWithType(value, event.currentTarget.value))}
    >
      {schemaTypeOptions(value).map((item) => (
        <option
          key={item}
          value={item}
          disabled={item === type && !SCHEMA_TYPES.includes(item as (typeof SCHEMA_TYPES)[number])}
        >
          {item}
        </option>
      ))}
    </Select>
  );
}

function enumText(value?: (string | number)[]): string {
  return value?.map((item) => String(item)).join(', ') ?? '';
}

function parseEnumText(value: string): (string | number)[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (/^-?(?:\d+\.?\d*|\.\d+)$/.test(item) ? Number(item) : item));
}

function SchemaEnumEditor({
  value,
  label,
  onChange,
  readonly,
}: {
  value: IJsonSchema;
  label: string;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
}) {
  return (
    <Input
      aria-label={`${label} allowed values`}
      placeholder="Allowed values, separated by commas"
      value={enumText(value.enum)}
      disabled={readonly}
      onChange={(event) => onChange({ ...value, enum: parseEnumText(event.target.value) })}
    />
  );
}

export function DisplaySchemaTag({ value, warning }: { value?: IJsonSchema; warning?: boolean }) {
  const [open, setOpen] = useState(false);
  const type = value?.type ?? 'any';
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Schema type ${type}`}
            aria-expanded={open}
            className={cn(
              'inline-flex shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              warning && 'border border-amber-500/60 text-amber-600 dark:text-amber-300'
            )}
          >
            {type}
          </button>
        }
      />
      <PopoverContent className="max-h-72 w-72 overflow-auto p-2" side="top" align="end">
        <PopoverTitle className="sr-only">Schema details</PopoverTitle>
        <SchemaPreview value={value} />
      </PopoverContent>
    </Popover>
  );
}

function SchemaPreview({ value, path = 'root' }: { value?: IJsonSchema; path?: string }) {
  if (!value) return <div className="text-xs text-muted-foreground">Any value</div>;
  const properties = Object.entries(value.properties ?? {});
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <code className="truncate text-muted-foreground">{path}</code>
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {value.type ?? 'any'}
        </span>
      </div>
      {value.description && <div className="text-muted-foreground">{value.description}</div>}
      {properties.map(([name, property]) => (
        <div className="ml-2 border-l border-border pl-2" key={name}>
          <SchemaPreview value={property} path={`${path}.${name}`} />
        </div>
      ))}
      {value.items && (
        <div className="ml-2 border-l border-border pl-2">
          <SchemaPreview value={value.items} path={`${path}[]`} />
        </div>
      )}
      {value.additionalProperties && (
        <div className="ml-2 border-l border-border pl-2">
          <SchemaPreview value={value.additionalProperties} path={`${path}{}`} />
        </div>
      )}
    </div>
  );
}

export function JsonSchemaEditor({
  value,
  onChange,
  readonly,
  hideRootSettings = false,
  requireOneField = false,
}: {
  value?: IJsonSchema;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
  hideRootSettings?: boolean;
  requireOneField?: boolean;
}) {
  const schema = value ?? { type: 'object', properties: {} };
  const isObject = schemaPropertyType(schema) === 'object';
  return (
    <div data-editor-control="schema-editor" className="flex min-w-0 flex-col gap-2">
      {!hideRootSettings && (
        <section
          data-schema-settings
          aria-label="Schema settings"
          className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-2"
        >
          <h3 className="text-xs font-medium text-foreground">Schema settings</h3>
          <SchemaDetails value={schema} label="Schema" onChange={onChange} readonly={readonly} />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_7rem] items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Type</span>
            <div className="min-w-0">
              <SchemaTypeSelect
                value={schema}
                label="Schema type"
                onChange={onChange}
                readonly={readonly}
              />
            </div>
          </div>
        </section>
      )}
      <section
        data-schema-fields-section
        aria-label={isObject ? 'Output fields' : 'Schema shape'}
        className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/10 p-2"
      >
        <h3 className="text-xs font-medium text-foreground">
          {isObject ? 'Output fields' : 'Schema shape'}
        </h3>
        {isObject ? (
          <JsonSchemaObjectEditor
            value={schema}
            onChange={onChange}
            readonly={readonly}
            minProperties={requireOneField ? 1 : undefined}
          />
        ) : (
          <SchemaShapeEditor
            value={schema}
            label="Schema"
            onChange={onChange}
            readonly={readonly}
            root
          />
        )}
      </section>
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
  minProperties,
}: {
  value?: IJsonSchema;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
  nested?: boolean;
  minProperties?: number;
}) {
  const properties = value?.properties ?? {};
  const required = value?.required ?? [];
  const entries = Object.entries(properties).sort(
    ([, left], [, right]) => (left.extra?.index ?? 0) - (right.extra?.index ?? 0)
  );

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
    if (!trimmed || trimmed === oldName || properties[trimmed]) return false;
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
    return true;
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
    const nextIndex =
      Math.max(0, ...Object.values(properties).map((property) => property.extra?.index ?? 0)) + 1;
    onChange(
      withSchemaProperties(value, {
        ...properties,
        [name]: { type: 'string', extra: { index: nextIndex } },
      })
    );
  };

  return (
    <div className={cn('flex flex-col gap-2', nested && 'border-l border-border pl-3')}>
      {entries.map(([name, property]) => (
        <div className="flex flex-col gap-1.5" key={name}>
          <div className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-center gap-1.5">
            <ObjectKeyInput
              name={name}
              readonly={readonly}
              ariaLabel={`Schema field ${name}`}
              onRename={(nextName) => renameProperty(name, nextName)}
            />
            <Select
              aria-label={`Schema type ${name}`}
              value={schemaPropertyType(property)}
              disabled={readonly}
              onChange={(event) => {
                const type = event.currentTarget.value;
                updateProperty(name, schemaWithType(property, type));
              }}
            >
              {schemaTypeOptions(property).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
            <Button
              aria-label={`Remove schema field ${name}`}
              title={
                minProperties && entries.length <= minProperties
                  ? 'At least one output field is required'
                  : undefined
              }
              size="icon-sm"
              variant="ghost"
              disabled={
                readonly || (minProperties !== undefined && entries.length <= minProperties)
              }
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
          <SchemaDetails
            value={property}
            label={`Schema field ${name}`}
            onChange={(next) => updateProperty(name, next)}
            readonly={readonly}
          />
          {schemaPropertyType(property) === 'object' && (
            <JsonSchemaObjectEditor
              value={property}
              onChange={(next) => updateProperty(name, next)}
              readonly={readonly}
              nested
            />
          )}
          {schemaPropertyType(property) === 'array' && (
            <SchemaShapeEditor
              value={property.items ?? { type: 'string' }}
              label={`${name} items`}
              onChange={(next) => updateProperty(name, { items: next })}
              readonly={readonly}
            />
          )}
          {schemaPropertyType(property) === 'map' && (
            <SchemaShapeEditor
              value={schemaChild(property, 'map')}
              label={`${name} values`}
              onChange={(next) => updateProperty(name, { additionalProperties: next })}
              readonly={readonly}
            />
          )}
          {schemaPropertyType(property) === 'enum' && (
            <SchemaEnumEditor
              value={property}
              label={`Schema field ${name}`}
              onChange={(next) => updateProperty(name, next)}
              readonly={readonly}
            />
          )}
        </div>
      ))}
      {minProperties !== undefined && entries.length <= minProperties && (
        <p data-schema-min-fields className="text-xs text-muted-foreground">
          At least one output field is required.
        </p>
      )}
      {!readonly && (
        <Button className="w-fit" size="sm" variant="outline" onClick={addProperty}>
          <Plus data-icon="inline-start" />
          Add field
        </Button>
      )}
    </div>
  );
}

function SchemaDetails({
  value,
  label,
  onChange,
  readonly,
}: {
  value: IJsonSchema;
  label: string;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
}) {
  const structured = ['array', 'object', 'map'].includes(schemaPropertyType(value));
  const [defaultDraft, setDefaultDraft] = useState(() => schemaDefaultText(value.default));
  const editingDefault = useRef(false);
  const schemaTypeRef = useRef(schemaPropertyType(value));

  useEffect(() => {
    const nextType = schemaPropertyType(value);
    if (schemaTypeRef.current !== nextType) {
      schemaTypeRef.current = nextType;
      editingDefault.current = false;
      setDefaultDraft(schemaDefaultText(value.default));
      return;
    }
    if (!editingDefault.current) setDefaultDraft(schemaDefaultText(value.default));
  }, [value, value.default]);

  const commitDefault = () => {
    if (!structured) return;
    editingDefault.current = false;
    if (defaultDraft.trim() === '') {
      onChange({ ...value, default: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(defaultDraft);
      if (JSON.stringify(parsed) !== JSON.stringify(value.default)) {
        onChange({ ...value, default: parsed });
      }
    } catch {
      setDefaultDraft(schemaDefaultText(value.default));
    }
  };

  return (
    <div className="grid gap-1.5 rounded-md bg-muted/30 p-2">
      <Input
        aria-label={`${label} description`}
        placeholder="Description"
        value={value.description ?? ''}
        disabled={readonly}
        onChange={(event) => onChange({ ...value, description: event.target.value })}
      />
      <Input
        aria-label={`${label} default`}
        placeholder="Default value"
        value={structured ? defaultDraft : schemaDefaultText(value.default)}
        disabled={readonly}
        onChange={(event) => {
          const nextText = event.target.value;
          if (!structured) {
            onChange({ ...value, default: parseSchemaDefault(nextText, value) });
            return;
          }
          editingDefault.current = true;
          setDefaultDraft(nextText);
          if (nextText.trim() === '') return;
          try {
            const parsed = JSON.parse(nextText);
            onChange({ ...value, default: parsed });
          } catch {
            // Keep the user's in-progress JSON locally until it becomes valid or blurs.
          }
        }}
        onBlur={commitDefault}
      />
    </div>
  );
}

function SchemaShapeEditor({
  value,
  label,
  onChange,
  readonly,
  root = false,
}: {
  value: IJsonSchema;
  label: string;
  onChange: (value: IJsonSchema) => void;
  readonly?: boolean;
  root?: boolean;
}) {
  const type = schemaPropertyType(value);
  return (
    <div className={cn(!root && 'ml-3 border-l border-border pl-3', 'flex flex-col gap-1.5')}>
      {!root && (
        <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <SchemaTypeSelect
            value={value}
            label={`${label} type`}
            onChange={onChange}
            readonly={readonly}
          />
        </div>
      )}
      {!root && (
        <SchemaDetails value={value} label={label} onChange={onChange} readonly={readonly} />
      )}
      {type === 'object' && (
        <JsonSchemaObjectEditor value={value} onChange={onChange} readonly={readonly} nested />
      )}
      {type === 'array' && (
        <SchemaShapeEditor
          value={schemaChild(value, 'array')}
          label={`${label} items`}
          onChange={(next) => onChange({ ...value, items: next })}
          readonly={readonly}
        />
      )}
      {type === 'map' && (
        <SchemaShapeEditor
          value={schemaChild(value, 'map')}
          label={`${label} values`}
          onChange={(next) => onChange({ ...value, additionalProperties: next })}
          readonly={readonly}
        />
      )}
      {type === 'enum' && (
        <SchemaEnumEditor value={value} label={label} onChange={onChange} readonly={readonly} />
      )}
    </div>
  );
}

function valueLabel(value: IFlowValue | undefined): string {
  if (!value) return '—';
  if (value.type === 'ref') return `{{${fieldText(value.content)}}}`;
  return fieldText(value.content) || '—';
}

export function DisplayInputsValues({ value }: { value?: IInputsValues }) {
  const entries = Object.entries(value ?? {});
  if (!entries.length)
    return <div className="text-xs text-muted-foreground">No inputs configured.</div>;
  return (
    <div className="flex flex-col gap-1.5" data-editor-control="inputs-display">
      {entries.map(([name, item]) => (
        <DisplayInputValue key={name} name={name} value={item} />
      ))}
    </div>
  );
}

function DisplayInputValue({ name, value }: { name: string; value?: IFlowValue | IInputsValues }) {
  if (value && !FlowValueUtils.isFlowValue(value))
    return <DisplayNestedInputValue name={name} value={value as IInputsValues} />;
  return <DisplayLeafInputValue name={name} value={value as IFlowValue | undefined} />;
}

function DisplayLeafInputValue({ name, value }: { name: string; value?: IFlowValue }) {
  const available = useScopeAvailable();
  const variable = value?.type === 'ref' ? available.getByKeyPath(value.content ?? []) : undefined;
  const schema =
    value?.type === 'ref'
      ? JsonSchemaUtils.astToSchema(variable?.type)
      : value?.type === 'constant'
      ? value.schema
      : value?.type === 'template'
      ? { type: 'string' }
      : undefined;

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
      <span className="truncate text-muted-foreground">{name}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        {value?.type === 'ref' ? (
          <span
            className="cm-variable-chip max-w-[65%] truncate"
            data-variable-chip={fieldText(value.content)}
            data-variable-unknown={!variable ? 'true' : undefined}
            title={`{{${fieldText(value.content)}}}`}
          >
            {(variable as { meta?: { title?: string } } | undefined)?.meta?.title ??
              fieldText(value.content).split('.').at(-1) ??
              fieldText(value.content)}
          </span>
        ) : (
          <code className="max-w-[65%] truncate text-foreground">{valueLabel(value)}</code>
        )}
        <DisplaySchemaTag value={schema} warning={value?.type === 'ref' && !variable} />
      </div>
    </div>
  );
}

function DisplayNestedInputValue({ name, value }: { name: string; value: IInputsValues }) {
  const available = useScopeAvailable();
  const schema = useMemo(
    () => FlowValueUtils.inferJsonSchema(value, available.scope),
    [available.version, value]
  );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5 text-xs">
        <span className="truncate text-muted-foreground">{name}</span>
        <DisplaySchemaTag value={schema} />
      </div>
      <div className="ml-3 min-w-0 border-l border-border pl-2">
        <DisplayInputsValues value={value} />
      </div>
    </div>
  );
}

function getFlowValueIndex(value: unknown): number {
  const flowValue = FlowValueUtils.isFlowValue(value) ? (value as IFlowValue) : undefined;
  return typeof flowValue?.extra?.index === 'number'
    ? flowValue.extra.index
    : Number.MAX_SAFE_INTEGER;
}

function orderedEntries<T>(value?: Record<string, T | undefined>) {
  return Object.entries(value ?? {}).sort(
    ([, left], [, right]) => getFlowValueIndex(left) - getFlowValueIndex(right)
  );
}

function renameObjectKey<T>(
  value: Record<string, T | undefined> | undefined,
  oldName: string,
  nextName: string
): Record<string, T | undefined> | undefined {
  const name = nextName.trim();
  if (!name || name === oldName || Object.prototype.hasOwnProperty.call(value ?? {}, name))
    return value;
  const next: Record<string, T | undefined> = {};
  for (const [key, item] of Object.entries(value ?? {})) next[key === oldName ? name : key] = item;
  return next;
}

function ObjectKeyInput({
  name,
  readonly,
  ariaLabel,
  onRename,
}: {
  name: string;
  readonly?: boolean;
  ariaLabel: string;
  onRename: (nextName: string) => boolean | void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  const commit = () => {
    const nextName = draft.trim();
    if (!nextName || nextName === name) {
      setDraft(name);
      return;
    }
    const accepted = onRename(nextName);
    if (accepted === false) setDraft(name);
    else setDraft(nextName);
  };

  return (
    <Input
      className="min-w-0 basis-[38%] max-w-44 shrink-0"
      data-input-key={ariaLabel.startsWith('Input') ? name : undefined}
      data-output-key={ariaLabel.startsWith('Output') ? name : undefined}
      aria-label={ariaLabel}
      value={draft}
      disabled={readonly}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function isInputGroup(value: unknown): value is IInputsValues {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !FlowValueUtils.isFlowValue(value)
  );
}

function InputValueRow({
  name,
  value,
  onChange,
  onRemove,
  onRename,
  readonly,
  schema,
  depth = 0,
}: {
  name: string;
  value?: IFlowValue | IInputsValues;
  onChange: (value: IFlowValue | IInputsValues) => void;
  onRemove: () => void;
  onRename?: (nextName: string) => boolean | void;
  readonly?: boolean;
  schema?: IJsonSchema;
  depth?: number;
}) {
  const group = isInputGroup(value);
  const groupValue: IInputsValues = group ? value : {};
  const [collapsed, setCollapsed] = useState(false);
  const entries = group ? orderedEntries(value) : [];
  const [newName, setNewName] = useState('');
  const updateChild = (childName: string, next: IFlowValue | IInputsValues) =>
    onChange({ ...groupValue, [childName]: next });
  const renameChild = (childName: string, nextName: string) => {
    const next = renameObjectKey(groupValue, childName, nextName);
    if (!next || next === value) return false;
    onChange(next);
    return true;
  };
  const addChild = () => {
    const childName = newName.trim();
    if (!childName || Object.prototype.hasOwnProperty.call(groupValue, childName)) return;
    onChange({
      ...groupValue,
      [childName]: {
        type: 'constant',
        content: '',
        schema: { type: 'string' },
        extra: { index: entries.length },
      },
    });
    setNewName('');
    setCollapsed(false);
  };
  return (
    <div
      className={cn('flex flex-col gap-1.5', depth > 0 && 'ml-3 border-l border-border pl-3')}
      data-input-group={group ? name : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <ObjectKeyInput
          name={name}
          readonly={readonly}
          ariaLabel={`Input key ${name}`}
          onRename={onRename ?? (() => false)}
        />
        {group ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} input ${name}`}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? 'Expand' : 'Configure'}
          </Button>
        ) : (
          <DynamicValueInput
            value={value as IFlowValue | undefined}
            onChange={onChange}
            readonly={readonly}
            schema={schema}
          />
        )}
        {!readonly && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Remove input ${name}`}
          >
            <X />
          </Button>
        )}
      </div>
      {group && !collapsed && (
        <div className="flex flex-col gap-1.5">
          {entries.map(([childName, childValue]) => (
            <InputValueRow
              key={childName}
              name={childName}
              value={childValue as IFlowValue | IInputsValues | undefined}
              onChange={(next) => updateChild(childName, next)}
              onRemove={() => {
                const next = { ...groupValue };
                delete next[childName];
                onChange(next);
              }}
              onRename={(nextName) => renameChild(childName, nextName)}
              readonly={readonly}
              schema={schema?.properties?.[childName]}
              depth={depth + 1}
            />
          ))}
          {!readonly && (
            <div className="ml-3 flex min-w-0 gap-1.5">
              <Input
                className="min-w-0 flex-1"
                aria-label={`New child input name for ${name}`}
                placeholder="Child input name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!newName.trim()}
                onClick={addChild}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const InputsValues = ({
  value,
  onChange,
  readonly,
  schema,
}: {
  value?: IInputsValues;
  onChange: (value: IInputsValues) => void;
  readonly?: boolean;
  schema?: IJsonSchema;
}) => {
  const entries = orderedEntries(value);
  const [newName, setNewName] = useState('');
  const update = (name: string, next: IFlowValue | IInputsValues) => {
    const current = value?.[name];
    const currentFlowValue = FlowValueUtils.isFlowValue(current)
      ? (current as IFlowValue)
      : undefined;
    const indexedNext = FlowValueUtils.isFlowValue(next)
      ? {
          ...next,
          extra: {
            ...(next.extra ?? {}),
            index:
              currentFlowValue?.extra?.index !== undefined
                ? currentFlowValue.extra.index
                : entries.findIndex(([key]) => key === name),
          },
        }
      : next;
    onChange({
      ...value,
      [name]: indexedNext as IFlowValue | IInputsValues,
    });
  };
  const remove = (name: string) => {
    const next = { ...value };
    delete next[name];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2" data-editor-control="inputs-values">
      {entries.map(([name, item]) => (
        <InputValueRow
          key={name}
          name={name}
          value={item as IFlowValue | IInputsValues | undefined}
          onChange={(next) => update(name, next)}
          onRemove={() => remove(name)}
          onRename={(nextName) => {
            const next = renameObjectKey(value, name, nextName);
            if (!next || next === value) return false;
            onChange(next);
            return true;
          }}
          readonly={readonly}
          schema={schema?.properties?.[name]}
        />
      ))}
      {!readonly && (
        <div className="flex min-w-0 gap-1.5">
          <Input
            className="min-w-0 flex-1"
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
              onChange({
                ...value,
                [name]: {
                  type: 'constant',
                  content: '',
                  schema: { type: 'string' },
                  extra: { index: entries.length },
                },
              });
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
  const currentScope = useCurrentScope();
  const refresh = useRefresh();
  useEffect(() => {
    if (!displayFromScope || !currentScope?.output?.onListOrAnyVarChange) return undefined;
    const disposable = currentScope.output.onListOrAnyVarChange(() => refresh());
    return () => disposable.dispose();
  }, [currentScope, displayFromScope, refresh]);

  const scopeProperties = (currentScope?.output?.variables ?? []).flatMap((variable) => {
    const schema = JsonSchemaUtils.astToSchema(variable.type);
    if (schema?.properties) return Object.entries(schema.properties);
    return [[variable.meta?.title || variable.key, schema ?? {}] as [string, IJsonSchema]];
  });
  const properties = displayFromScope ? scopeProperties : Object.entries(value?.properties ?? {});
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
    <div
      data-batch-variable-selector="true"
      style={style}
      className={cn(hasError && 'rounded-lg ring-1 ring-destructive/40')}
    >
      <PrivateScopeProvider>
        <VariablePicker
          value={value}
          includeSchema={{ type: 'array', extra: { weak: true } }}
          readonly={readonly}
          hasError={hasError}
          onChange={(next) => onChange(next ?? [])}
        />
      </PrivateScopeProvider>
    </div>
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
  const entries = orderedEntries(value);
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
        <div className="flex items-center gap-1.5" data-output-row={name} key={name}>
          <ObjectKeyInput
            name={name}
            readonly={readonly}
            ariaLabel={`Output key ${name}`}
            onRename={(nextName) => {
              const next = renameObjectKey(value, name, nextName);
              if (!next || next === value) return false;
              onChange(next);
              return true;
            }}
          />
          <VariablePicker
            value={item?.content}
            readonly={readonly}
            hasError={hasError}
            onChange={(next) =>
              onChange({
                ...value,
                [name]: { ...(item ?? {}), type: 'ref', content: next ?? [] },
              })
            }
          />
          {!readonly && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove output ${name}`}
              onClick={() => {
                const next = { ...value };
                delete next[name];
                onChange(next);
              }}
            >
              <X />
            </Button>
          )}
        </div>
      ))}
      {!readonly && (
        <div className="flex min-w-0 gap-1.5">
          <Input
            className="min-w-0 flex-1"
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
              onChange({
                ...value,
                [trimmedName]: { type: 'ref', content: [], extra: { index: entries.length } },
              });
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
                  <VariablePicker
                    value={row.left?.content}
                    readonly={readonly}
                    onChange={(nextValue) => {
                      const next = [...rows] as AssignValueType[];
                      next[index] = {
                        ...row,
                        left: { type: 'ref', content: nextValue ?? [] },
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
      <VariablePicker
        value={left?.content}
        readonly={readonly}
        onChange={(next) =>
          onChange({
            ...value,
            left: { ...(value?.left ?? {}), type: 'ref', content: next ?? [] },
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

type VariableFieldLike = {
  key: string;
  type?: {
    properties?: VariableFieldLike[];
    [key: string]: unknown;
  };
  meta?: VariableMetaLike;
};

type VariableMetaLike = {
  title?: string;
  icon?: string | React.ReactNode;
  disabled?: boolean;
};

export function useVariableTree({
  includeSchema,
  excludeSchema,
  skipVariable,
}: {
  includeSchema?: IJsonSchema | IJsonSchema[];
  excludeSchema?: IJsonSchema | IJsonSchema[];
  skipVariable?: (variable: VariableFieldLike) => boolean;
} = {}) {
  const context = useVariableSelectorContext();
  const effectiveIncludeSchema = includeSchema ?? context.includeSchema;
  const effectiveExcludeSchema = excludeSchema ?? context.excludeSchema;
  const effectiveSkipVariable = skipVariable ?? context.skipVariable;
  const typeManager = useTypeManager() as JsonSchemaTypeManager;
  const variables = useAvailableVariables();

  return useMemo(() => {
    type VariableTreeNode = {
      key: string;
      label: string;
      value: string;
      keyPath: string[];
      children?: VariableTreeNode[];
      rootMeta?: VariableFieldLike['meta'];
      icon?: VariableMetaLike['icon'];
      isRoot?: boolean;
      disabled?: boolean;
    };

    const renderVariable = (
      variable: VariableFieldLike,
      parentFields: VariableFieldLike[] = []
    ): VariableTreeNode | null => {
      if (!variable?.type) return null;
      const children = variable.type.properties
        ?.map((property) => renderVariable(property, [...parentFields, variable]))
        .filter(Boolean) as VariableTreeNode[] | undefined;
      const keyPath = [...parentFields.map((field) => field.key), variable.key];
      const key = keyPath.join('.');
      const isSchemaIncluded = effectiveIncludeSchema
        ? JsonSchemaUtils.isASTMatchSchema(variable.type as never, effectiveIncludeSchema)
        : true;
      const isSchemaExcluded = effectiveExcludeSchema
        ? JsonSchemaUtils.isASTMatchSchema(variable.type as never, effectiveExcludeSchema)
        : false;
      const isMatch =
        isSchemaIncluded &&
        !isSchemaExcluded &&
        !effectiveSkipVariable?.(variable) &&
        !variable.meta?.disabled;

      if (!isMatch && !children?.length) return null;

      const schema = JsonSchemaUtils.astToSchema(variable.type as never, {
        drilldownObject: false,
      });
      const icon = variable.meta?.icon ?? (schema ? typeManager.getDisplayIcon(schema) : undefined);

      return {
        key,
        label: variable.meta?.title || variable.key,
        value: key,
        keyPath,
        children: children?.length ? children : undefined,
        rootMeta: parentFields[0]?.meta || variable.meta,
        icon,
        isRoot: parentFields.length === 0,
        disabled: !isMatch,
      };
    };

    return variables
      .slice()
      .reverse()
      .map((variable) => renderVariable(variable as VariableFieldLike))
      .filter(Boolean) as VariableTreeNode[];
  }, [
    effectiveExcludeSchema,
    effectiveIncludeSchema,
    effectiveSkipVariable,
    typeManager,
    variables,
  ]);
}

type VariableTreeNode = ReturnType<typeof useVariableTree>[number];

type VariableTreeKeyboardNode = {
  key: string;
  value: string;
  label: string;
  keyPath: string[];
  rootMeta?: VariableFieldLike['meta'];
  icon?: VariableMetaLike['icon'];
  isRoot?: boolean;
  children?: VariableTreeKeyboardNode[];
  disabled?: boolean;
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
  onSelect?: (node: VariableTreeKeyboardNode) => void
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
      if (!current.node.disabled) onSelect?.(current.node);
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
  onSelect: (node: VariableTreeNode) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = expanded.has(node.key);

  return (
    <div
      role="treeitem"
      data-variable-tree-item={node.key}
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-disabled={node.disabled || undefined}
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
          aria-disabled={node.disabled || undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
            node.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
          )}
          onKeyDown={(event) => {
            onKeyDown(event);
            event.stopPropagation();
          }}
          onClick={() => {
            if (!node.disabled) onSelect(node);
          }}
        >
          {typeof node.icon === 'string' ? (
            <img src={node.icon} alt="" width={14} height={14} className="shrink-0" />
          ) : node.icon ? (
            <span className="shrink-0">{node.icon}</span>
          ) : null}
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
  onSelect: (node: VariableTreeNode) => void;
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

function findVariableTreeNode(
  nodes: VariableTreeNode[],
  value: string[]
): VariableTreeNode | undefined {
  for (const node of nodes) {
    if (
      node.keyPath.length === value.length &&
      node.keyPath.every((part, index) => part === value[index])
    ) {
      return node;
    }
    const match = node.children && findVariableTreeNode(node.children, value);
    if (match) return match;
  }
  return undefined;
}

function findVariableTreeNodeByValue(
  nodes: VariableTreeNode[],
  value: string
): VariableTreeNode | undefined {
  for (const node of nodes) {
    if (node.value === value) return node;
    const match = node.children && findVariableTreeNodeByValue(node.children, value);
    if (match) return match;
  }
  return undefined;
}

export function VariablePicker({
  value,
  onChange,
  readonly,
  hasError,
  includeSchema,
  excludeSchema,
  skipVariable,
}: {
  value?: string[];
  onChange: (value?: string[]) => void;
  readonly?: boolean;
  hasError?: boolean;
  includeSchema?: IJsonSchema | IJsonSchema[];
  excludeSchema?: IJsonSchema | IJsonSchema[];
  skipVariable?: (variable: VariableFieldLike) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const treeData = useVariableTree({ includeSchema, excludeSchema, skipVariable });
  const selected = value?.length ? findVariableTreeNode(treeData, value) : undefined;
  const isUnknown = Boolean(value?.length && !selected);
  const label = selected
    ? selected.isRoot || !selected.rootMeta?.title
      ? selected.label
      : `${selected.rootMeta.title} - ${selected.label}`
    : isUnknown
    ? 'Undefined'
    : 'Select variable';

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <div className="relative min-w-0 w-full">
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Select variable"
              disabled={readonly}
              aria-expanded={open}
              data-variable-picker="true"
              title={value?.length ? value.join('.') : undefined}
              className={cn(
                'w-full justify-between pr-8 font-normal',
                isUnknown && 'border-amber-500/60 text-amber-600 dark:text-amber-300',
                hasError && 'border-destructive'
              )}
            >
              <span
                className="flex min-w-0 items-center gap-1.5 truncate"
                data-variable-chip={value?.length ? value.join('.') : undefined}
                data-variable-unknown={isUnknown ? 'true' : undefined}
              >
                <span className="truncate">{label}</span>
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          }
        />
        {value?.length && !readonly ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-variable-clear="true"
            aria-label="Clear variable"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
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
            onChange(next.keyPath);
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
