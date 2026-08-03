import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import {
  Activity,
  AlignHorizontalSpaceAround,
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bold,
  Bot,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  Cloud,
  Code2,
  Columns3,
  Database,
  Download,
  ExternalLink,
  FileJson2,
  FolderUp,
  FileClock,
  GitBranch,
  Globe2,
  GripVertical,
  History,
  Italic,
  LoaderCircle,
  List,
  ListPlus,
  Maximize2,
  MessageSquareText,
  Moon,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  Play,
  Plus,
  Radio,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  Split,
  Sun,
  TextCursorInput,
  Trash2,
  Undo2,
  Upload,
  Variable,
  WandSparkles,
  Webhook,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react';

import { cn } from '@/prototypes/shadcn-ui/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/prototypes/shadcn-ui/components/ui/tooltip';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/prototypes/shadcn-ui/components/ui/tabs';
import { Separator } from '@/prototypes/shadcn-ui/components/ui/separator';
import { ScrollArea } from '@/prototypes/shadcn-ui/components/ui/scroll-area';
import { Input } from '@/prototypes/shadcn-ui/components/ui/input';
import { Card } from '@/prototypes/shadcn-ui/components/ui/card';
import { Button, buttonVariants } from '@/prototypes/shadcn-ui/components/ui/button';
import { Badge } from '@/prototypes/shadcn-ui/components/ui/badge';

type View = 'workflows' | 'agents' | 'settings' | 'editor';
type Variant = 'A' | 'B' | 'C';
type StackTransition = 'idle' | 'leaving' | 'entering';
type Icon = ComponentType<{ className?: string }>;
type CanvasNodeId = 'start' | 'llm' | 'condition' | 'http' | 'end';
type CanvasPosition = { x: number; y: number };
type OutputMode = 'fields' | 'json';
type OutputField = { id: number; key: string; type: 'string' | 'number' | 'boolean' };

const INITIAL_NODE_POSITIONS: Record<CanvasNodeId, CanvasPosition> = {
  start: { x: 1.5, y: 48 },
  llm: { x: 34, y: 34 },
  condition: { x: 67, y: 48 },
  http: { x: 67, y: 20 },
  end: { x: 67, y: 76 },
};

const CANVAS_EDGES: Array<{ source: CanvasNodeId; target: CanvasNodeId; active?: boolean }> = [
  { source: 'start', target: 'llm' },
  { source: 'llm', target: 'condition', active: true },
  { source: 'condition', target: 'http' },
  { source: 'condition', target: 'end' },
];

const VIEW_ITEMS: Array<{ id: View; label: string; shortLabel: string; icon: Icon }> = [
  { id: 'workflows', label: 'Workflows', shortLabel: 'Flows', icon: Workflow },
  { id: 'agents', label: 'Agents', shortLabel: 'Agents', icon: Bot },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

const VARIANTS: Array<{ id: Variant; name: string; description: string }> = [
  { id: 'A', name: 'Workbench Rail', description: 'persistent navigation + contextual inspector' },
  { id: 'B', name: 'Command Deck', description: 'top navigation + execution dock' },
  { id: 'C', name: 'Focus Dock', description: 'icon rail + floating context' },
];

const WORKFLOWS = [
  {
    name: 'Support triage',
    description: 'Classify requests, gather context and prepare a response for review.',
    status: 'Published',
    nodes: 8,
    lastRun: '4 min ago',
    success: '98.1%',
    accent: 'bg-blue-500',
  },
  {
    name: 'Research brief',
    description: 'Collect sources, synthesize evidence and generate a structured brief.',
    status: 'Draft',
    nodes: 12,
    lastRun: 'Yesterday',
    success: '94.8%',
    accent: 'bg-violet-500',
  },
  {
    name: 'Release notes',
    description: 'Transform merged changes into concise customer-facing release notes.',
    status: 'Published',
    nodes: 6,
    lastRun: '3 days ago',
    success: '100%',
    accent: 'bg-emerald-500',
  },
];

const AGENTS = [
  { name: 'Support analyst', model: 'gpt-5', status: 'Ready', color: 'bg-blue-600' },
  { name: 'Research lead', model: 'deepseek-v4-pro', status: 'Ready', color: 'bg-violet-600' },
  { name: 'Release editor', model: 'gpt-5-mini', status: 'Draft', color: 'bg-amber-600' },
];

const NODE_TYPES = [
  ['Start', Radio],
  ['End', CircleStop],
  ['LLM', Sparkles],
  ['HTTP', Globe2],
  ['Code', Code2],
  ['Variable', Variable],
  ['Condition', GitBranch],
  ['Multi-condition', Split],
  ['Loop', RefreshCw],
  ['Group', Box],
  ['Comment', MessageSquareText],
  ['Block start', AlignHorizontalSpaceAround],
  ['Block end', ArrowDownToLine],
  ['Continue', Redo2],
  ['Break', CircleStop],
] as const;

function readQuery(): { variant: Variant; view: View; compare: boolean } {
  const params = new URLSearchParams(window.location.search);
  const variant = params.get('variant');
  const view = params.get('view');

  return {
    variant: variant === 'B' || variant === 'C' ? variant : 'A',
    view: view === 'workflows' || view === 'agents' || view === 'settings' ? view : 'editor',
    compare: params.get('compare') === '1',
  };
}

export function PrototypeApp() {
  const initial = useMemo(readQuery, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [view, setView] = useState<View>(initial.view);
  const [dark, setDark] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState('Support triage');
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTransition, setAgentTransition] = useState<StackTransition>('idle');
  const [selectedNode, setSelectedNode] = useState<CanvasNodeId | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant);
    url.searchParams.set('view', view);
    window.history.replaceState(null, '', url);
  }, [variant, view]);

  useEffect(() => {
    if (!initial.compare) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      const current = VARIANTS.findIndex((item) => item.id === variant);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = (current + direction + VARIANTS.length) % VARIANTS.length;
      setVariant(VARIANTS[next].id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [initial.compare, variant]);

  const changeView = (nextView: View) => {
    if (nextView !== 'editor') {
      setSelectedNode(null);
    }
    if (nextView !== 'agents') {
      setSelectedAgent(null);
      setAgentTransition('idle');
    }
    setView(nextView);
  };

  const openAgent = (index: number) => {
    setAgentTransition('leaving');
    window.setTimeout(() => {
      setSelectedAgent(index);
      setAgentTransition('entering');
      window.setTimeout(() => setAgentTransition('idle'), 220);
    }, 160);
  };

  const closeAgent = () => {
    setAgentTransition('leaving');
    window.setTimeout(() => {
      setSelectedAgent(null);
      setAgentTransition('entering');
      window.setTimeout(() => setAgentTransition('idle'), 220);
    }, 160);
  };

  const openWorkflow = (name: string) => {
    setSelectedWorkflow(name);
    setView('editor');
  };

  const shared: LayoutProps = {
    view,
    setView: changeView,
    dark,
    setDark,
    running,
    selectedWorkflow,
    selectedAgent,
    selectedNode,
    agentTransition,
    onOpenAgent: openAgent,
    onCloseAgent: closeAgent,
    onOpenWorkflow: openWorkflow,
    onSelectNode: setSelectedNode,
    onRun: () => {
      setRunning(true);
      window.setTimeout(() => setRunning(false), 1400);
    },
  };

  return (
    <TooltipProvider>
      <div className={cn('prototype-root', dark && 'dark')} data-variant={variant}>
        {variant === 'A' && <WorkbenchRail {...shared} />}
        {variant === 'B' && <CommandDeck {...shared} />}
        {variant === 'C' && <FocusDock {...shared} />}
        {initial.compare && view === 'editor' && (
          <VariantSwitcher variant={variant} onChange={setVariant} />
        )}
      </div>
    </TooltipProvider>
  );
}

interface LayoutProps {
  view: View;
  setView: (view: View) => void;
  dark: boolean;
  setDark: (dark: boolean) => void;
  running: boolean;
  onRun: () => void;
  selectedWorkflow: string;
  selectedAgent: number | null;
  selectedNode: CanvasNodeId | null;
  agentTransition: StackTransition;
  onOpenAgent: (index: number) => void;
  onCloseAgent: () => void;
  onOpenWorkflow: (name: string) => void;
  onSelectNode: (nodeId: CanvasNodeId | null) => void;
}

function WorkbenchRail(props: LayoutProps) {
  const { view, setView, dark, setDark } = props;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen gap-2 overflow-hidden bg-muted/40 p-2 text-foreground">
      <aside
        className={cn(
          'flex shrink-0 flex-col overflow-hidden rounded-2xl border bg-sidebar shadow-sm transition-[width] duration-200',
          collapsed ? 'w-14' : 'w-[212px]'
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center px-2', collapsed && 'justify-center')}>
          {collapsed ? (
            <IconButton
              className="text-muted-foreground/50 hover:text-muted-foreground"
              label="Expand sidebar"
              onClick={() => setCollapsed(false)}
            >
              <ChevronRight />
            </IconButton>
          ) : (
            <>
              <button
                aria-label="Open workflow editor"
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background"
                onClick={() => setView('editor')}
                type="button"
              >
                <Zap className="size-4" />
              </button>
              <span className="ml-2 text-sm font-semibold">Studio</span>
              <div className="flex-1" />
              <IconButton
                className="text-muted-foreground/50 hover:text-muted-foreground"
                label="Collapse sidebar"
                onClick={() => setCollapsed(true)}
              >
                <ChevronLeft />
              </IconButton>
            </>
          )}
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {VIEW_ITEMS.map((item) => (
            <RailNavItem
              key={item.id}
              active={view === item.id}
              collapsed={collapsed}
              icon={item.icon}
              label={item.label}
              onClick={() => setView(item.id)}
            />
          ))}
        </nav>
        <div className={cn('mt-auto flex p-2', collapsed ? 'justify-center' : 'justify-end pr-3')}>
          <ThemeToggle dark={dark} setDark={setDark} />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm">
        <WorkbenchHeader {...props} />
        <div className={cn('flex min-h-0 flex-1', view === 'editor' && 'workflow-canvas')}>
          <main className="min-w-0 flex-1 overflow-auto">
            <ViewContent variant="A" {...props} />
          </main>
          {view === 'editor' && props.selectedNode === 'llm' && (
            <Inspector variant="A" onClose={() => props.onSelectNode(null)} />
          )}
        </div>
      </section>
    </div>
  );
}

function WorkbenchHeader(props: LayoutProps) {
  const { view, setView, running, onRun, selectedWorkflow } = props;

  if (view !== 'editor') {
    return null;
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/80 bg-background px-4">
      <Button variant="ghost" size="sm" onClick={() => setView('workflows')}>
        <ArrowLeft data-icon="inline-start" /> Workflows
      </Button>
      <span className="text-muted-foreground/50">/</span>
      <span className="text-sm font-semibold">{selectedWorkflow}</span>
      <Badge className="ml-1" variant="outline">
        Draft
      </Badge>
      <span className="text-xs text-muted-foreground">Saved just now</span>
      <div className="ml-auto flex items-center gap-1.5">
        <IconButton label="Undo">
          <Undo2 />
        </IconButton>
        <IconButton label="Redo">
          <Redo2 />
        </IconButton>
        <Separator className="mx-1 h-5" orientation="vertical" />
        <Button variant="outline" size="sm">
          <Save data-icon="inline-start" /> Save
        </Button>
        <Button size="sm" onClick={onRun} disabled={running}>
          {running ? <LoaderCircle className="animate-spin" /> : <Play data-icon="inline-start" />}
          {running ? 'Running' : 'Test run'}
        </Button>
      </div>
    </header>
  );
}

function CommandDeck(props: LayoutProps) {
  const {
    view,
    setView,
    dark,
    setDark,
    running,
    onRun,
    selectedAgent,
    selectedWorkflow,
    onOpenWorkflow,
  } = props;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-5">
        <Brand compact />
        <nav className="ml-8 flex items-center gap-1 rounded-lg bg-muted/70 p-1">
          {VIEW_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={view === item.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView(item.id)}
            >
              <item.icon data-icon="inline-start" /> {item.label}
            </Button>
          ))}
        </nav>
        <button
          className="ml-5 flex w-[320px] items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/60"
          type="button"
        >
          <Search className="size-4" />
          <span className="flex-1">Search workflows, agents, runs…</span>
          <kbd className="rounded border bg-background px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle dark={dark} setDark={setDark} />
          {view === 'workflows' && (
            <Button size="sm" onClick={() => onOpenWorkflow('Untitled workflow')}>
              <Plus data-icon="inline-start" /> New workflow
            </Button>
          )}
          {view === 'agents' && selectedAgent === null && (
            <Button size="sm">
              <Plus data-icon="inline-start" /> New agent
            </Button>
          )}
          <div className="ml-1 flex size-8 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            ZT
          </div>
        </div>
      </header>

      {view === 'editor' && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/80 bg-muted/25 px-5">
          <Button variant="ghost" size="sm" onClick={() => setView('workflows')}>
            <PanelLeftClose data-icon="inline-start" /> All workflows
          </Button>
          <Separator className="mx-1 h-5" orientation="vertical" />
          <span className="text-sm font-semibold">{selectedWorkflow}</span>
          <Badge variant="secondary">Draft</Badge>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="History">
              <History />
            </IconButton>
            <Button variant="outline" size="sm">
              <Save data-icon="inline-start" /> Save
            </Button>
            <Button size="sm" onClick={onRun} disabled={running}>
              {running ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {running ? 'Running' : 'Run'}
            </Button>
          </div>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto">
        <ViewContent variant="B" {...props} />
      </main>
      {view === 'editor' && <ExecutionDock running={running} />}
    </div>
  );
}

function FocusDock(props: LayoutProps) {
  const {
    view,
    setView,
    dark,
    setDark,
    running,
    onRun,
    selectedAgent,
    selectedWorkflow,
    onOpenWorkflow,
  } = props;

  return (
    <div className="grid h-screen grid-cols-[64px_minmax(0,1fr)] overflow-hidden bg-muted/30 text-foreground">
      <aside className="flex flex-col items-center border-r border-border bg-background py-3">
        <button
          className="mb-5 flex size-9 items-center justify-center rounded-xl bg-foreground text-background"
          onClick={() => setView('editor')}
          type="button"
        >
          <Zap className="size-4" />
        </button>
        <nav className="space-y-2">
          {VIEW_ITEMS.map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger
                className={cn(
                  'flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  view === item.id &&
                    'bg-foreground text-background hover:bg-foreground hover:text-background'
                )}
                onClick={() => setView(item.id)}
              >
                <item.icon className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          <ThemeToggle dark={dark} setDark={setDark} />
          <div className="flex size-9 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
            ZT
          </div>
        </div>
      </aside>

      <div className="relative m-2 ml-0 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_1px_3px_rgb(15_23_42/0.08)]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <div>
            <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {view === 'editor' ? 'Workflow editor' : 'Management'}
            </div>
            <div className="text-sm font-semibold">
              {view === 'editor' ? selectedWorkflow : view[0].toUpperCase() + view.slice(1)}
            </div>
          </div>
          {view === 'editor' && <Badge variant="outline">Draft</Badge>}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              className="mr-2 flex items-center gap-2 text-xs text-muted-foreground"
              type="button"
            >
              <span className="size-1.5 rounded-full bg-emerald-500" /> Saved
            </button>
            <IconButton label="Workflow history">
              <FileClock />
            </IconButton>
            {view === 'workflows' && (
              <Button size="sm" onClick={() => onOpenWorkflow('Untitled workflow')}>
                <Plus data-icon="inline-start" /> New workflow
              </Button>
            )}
            {view === 'agents' && selectedAgent === null && (
              <Button size="sm">
                <Plus data-icon="inline-start" /> New agent
              </Button>
            )}
            {view === 'editor' && (
              <>
                <Button variant="outline" size="sm">
                  <Save data-icon="inline-start" /> Save
                </Button>
                <Button size="sm" onClick={onRun} disabled={running}>
                  {running ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  {running ? 'Running' : 'Test run'}
                </Button>
              </>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <ViewContent variant="C" {...props} />
        </main>
        {view === 'editor' && props.selectedNode === 'llm' && (
          <Inspector variant="C" onClose={() => props.onSelectNode(null)} />
        )}
      </div>
    </div>
  );
}

function ViewContent(props: LayoutProps & { variant: Variant }) {
  switch (props.view) {
    case 'workflows':
      return <WorkflowsPage variant={props.variant} onOpen={props.onOpenWorkflow} />;
    case 'agents':
      return (
        <AgentsPage
          variant={props.variant}
          selectedAgent={props.selectedAgent}
          transition={props.agentTransition}
          onSelectAgent={props.onOpenAgent}
          onClose={props.onCloseAgent}
        />
      );
    case 'settings':
      return <SettingsPage variant={props.variant} />;
    default:
      return (
        <EditorCanvas
          variant={props.variant}
          running={props.running}
          selectedNode={props.selectedNode}
          onSelectNode={props.onSelectNode}
        />
      );
  }
}

function WorkflowsPage({ variant, onOpen }: { variant: Variant; onOpen: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState(false);
  const visibleWorkflows = WORKFLOWS.filter((workflow) =>
    `${workflow.name} ${workflow.description}`.toLowerCase().includes(query.toLowerCase())
  );

  const openWorkflow = (name: string) => {
    setLeaving(true);
    window.setTimeout(() => onOpen(name), 160);
  };

  return (
    <div
      className={cn(
        'stack-screen mx-auto min-h-full max-w-[1240px] p-6 lg:p-8',
        leaving && 'is-leaving',
        !leaving && 'is-entering',
        variant === 'C' && 'max-w-[1120px]'
      )}
    >
      <div className="mb-5 flex items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input
            aria-label="Search workflows"
            className="pl-8"
            placeholder="Search workflows"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Badge variant="secondary">{visibleWorkflows.length} workflows</Badge>
        {variant === 'A' && (
          <Button className="ml-auto" size="sm" onClick={() => openWorkflow('Untitled workflow')}>
            <Plus data-icon="inline-start" /> New workflow
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleWorkflows.map((workflow) => (
          <button key={workflow.name} onClick={() => openWorkflow(workflow.name)} type="button">
            <Card className="group h-full gap-4 border-border/80 p-4 text-left shadow-none transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm">
              <div className="flex items-start gap-3">
                <span className={cn('mt-1 size-2 rounded-full', workflow.accent)} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{workflow.name}</h2>
                  <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">
                    {workflow.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={workflow.status === 'Published' ? 'secondary' : 'outline'}>
                  {workflow.status}
                </Badge>
                <span className="text-muted-foreground">{workflow.nodes} nodes</span>
                <span className="ml-auto font-medium">{workflow.success}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock3 className="size-3.5" /> {workflow.lastRun}
                </span>
                <span className="flex items-center gap-1 font-medium text-foreground">
                  Open <ArrowRight className="size-3.5" />
                </span>
              </div>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}

const AGENT_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'system-prompt', label: 'System prompt', icon: MessageSquareText },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'runtime', label: 'Runtime', icon: Code2 },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'extensions', label: 'Extensions', icon: Box },
  { id: 'memories', label: 'Memories', icon: Database },
  { id: 'sessions', label: 'Sessions', icon: History },
  { id: 'stats', label: 'Statistics', icon: Activity },
] as const;

type AgentSectionId = (typeof AGENT_SECTIONS)[number]['id'];

function AgentsPage({
  variant,
  selectedAgent,
  transition,
  onSelectAgent,
  onClose,
}: {
  variant: Variant;
  selectedAgent: number | null;
  transition: StackTransition;
  onSelectAgent: (index: number) => void;
  onClose: () => void;
}) {
  const selected = selectedAgent ?? 0;
  const [agentNames, setAgentNames] = useState(() => AGENTS.map((agent) => agent.name));
  const [query, setQuery] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [providerUrl, setProviderUrl] = useState('https://api.openai.com/v1');
  const [models, setModels] = useState<string[]>([AGENTS[0].model]);
  const [model, setModel] = useState(AGENTS[0].model);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [providerStatus, setProviderStatus] = useState<'idle' | 'testing' | 'connected'>('idle');
  const [systemPrompt, setSystemPrompt] = useState(
    'Analyze incoming support requests, ground every claim in available context, and prepare a concise response for human review.'
  );
  const [description, setDescription] = useState(
    'Analyzes incoming support requests and prepares a grounded response for human review.'
  );
  const [enabledTools, setEnabledTools] = useState(['web_search', 'read_file']);
  const [skillNames, setSkillNames] = useState([
    'Support triage',
    'Source verification',
    'Response editor',
  ]);
  const [enabledSkills, setEnabledSkills] = useState(['Support triage']);
  const [enabledExtensions, setEnabledExtensions] = useState(['Git context']);
  const [activeSection, setActiveSection] = useState<AgentSectionId>('general');
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState('');
  const [sessionTitle, setSessionTitle] = useState('New session');
  const [sessionMessages, setSessionMessages] = useState<
    Array<{ role: 'assistant' | 'user'; text: string }>
  >([{ role: 'assistant', text: 'Hi — what would you like to work on?' }]);

  const agent = { ...AGENTS[selected], name: agentNames[selected], model };
  const visibleAgents = AGENTS.map((item, index) => ({ item, index })).filter(({ item, index }) =>
    `${agentNames[index]} ${item.model}`.toLowerCase().includes(query.toLowerCase())
  );

  const selectAgent = (index: number) => {
    const nextAgent = AGENTS[index];
    setEditingName(false);
    setActiveSection('general');
    setSessionOpen(false);
    setModel(nextAgent.model);
    setModels([nextAgent.model]);
    setProviderUrl(
      nextAgent.model.startsWith('deepseek')
        ? 'https://api.deepseek.com/v1'
        : 'https://api.openai.com/v1'
    );
    setProviderStatus('idle');
    onSelectAgent(index);
  };

  const fetchModels = () => {
    setFetchingModels(true);
    setProviderStatus('idle');
    window.setTimeout(() => {
      const discovered = providerUrl.includes('deepseek')
        ? ['deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
        : ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];
      setModels(discovered);
      setModel(discovered[0]);
      setFetchingModels(false);
    }, 450);
  };

  const testProvider = () => {
    setProviderStatus('testing');
    window.setTimeout(() => setProviderStatus('connected'), 650);
  };

  const sendSessionMessage = () => {
    const message = sessionDraft.trim();
    if (!message) return;

    setSessionMessages((current) => [
      ...current,
      { role: 'user', text: message },
      {
        role: 'assistant',
        text: 'I’ll answer using this agent’s current prompt, tools, and runtime settings.',
      },
    ]);
    setSessionDraft('');
  };

  const startNewSession = () => {
    setSessionTitle('New session');
    setSessionMessages([{ role: 'assistant', text: 'Hi — what would you like to work on?' }]);
    setSessionDraft('');
    setSessionOpen(true);
  };

  const openSession = (name: string) => {
    setSessionTitle(name);
    setSessionMessages([
      {
        role: 'user',
        text:
          name === 'Support request #1842'
            ? 'Summarize the customer request and next action.'
            : name,
      },
      {
        role: 'assistant',
        text: 'This is the saved conversation for this session. You can continue from here.',
      },
    ]);
    setSessionDraft('');
    setSessionOpen(true);
  };

  const importSkillFolder = (files: FileList | null) => {
    const firstFile = files?.[0] as (File & { webkitRelativePath?: string }) | undefined;
    if (!firstFile) return;

    const folderName = firstFile.webkitRelativePath?.split('/')[0] || firstFile.name;
    setSkillNames((current) => (current.includes(folderName) ? current : [...current, folderName]));
    setEnabledSkills((current) =>
      current.includes(folderName) ? current : [...current, folderName]
    );
  };

  const toggleValue = (value: string, current: string[], update: (next: string[]) => void) =>
    update(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );

  if (selectedAgent === null) {
    return (
      <div
        className={cn(
          'stack-screen mx-auto min-h-full max-w-[1120px] p-4 lg:p-6',
          transition === 'leaving' && 'is-leaving',
          transition === 'entering' && 'is-entering'
        )}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search agents"
              className="pl-8"
              placeholder="Search agents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Badge variant="secondary">{visibleAgents.length} agents</Badge>
          {variant === 'A' && (
            <div className="ml-auto flex items-center gap-1.5">
              <IconButton label="Export agents">
                <Download />
              </IconButton>
              <Button variant="outline" size="sm">
                <Upload data-icon="inline-start" /> Import
              </Button>
              <Button size="sm">
                <Plus data-icon="inline-start" /> New agent
              </Button>
            </div>
          )}
        </div>
        <Card className="gap-0 overflow-hidden p-0 shadow-none">
          {visibleAgents.map(({ item, index }) => (
            <button
              className="group flex w-full items-center gap-4 border-b px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/50"
              key={item.name}
              onClick={() => selectAgent(index)}
              type="button"
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl text-white',
                  item.color
                )}
              >
                <Bot className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{agentNames[index]}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  OpenAI-compatible · {item.model}
                </span>
              </span>
              <Badge
                className="w-14 justify-center"
                variant={item.status === 'Ready' ? 'secondary' : 'outline'}
              >
                {item.status}
              </Badge>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'stack-screen flex h-full min-h-0 flex-col overflow-hidden',
        transition === 'leaving' && 'is-leaving',
        transition === 'entering' && 'is-entering'
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <IconButton label="Back to agents" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-white',
            agent.color
          )}
        >
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0">
          {editingName ? (
            <Input
              aria-label="Agent name"
              autoFocus
              className="h-7 max-w-sm text-sm font-semibold"
              value={agent.name}
              onBlur={() => setEditingName(false)}
              onChange={(event) =>
                setAgentNames((current) =>
                  current.map((name, index) => (index === selected ? event.target.value : name))
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') setEditingName(false);
              }}
            />
          ) : (
            <button
              className="group flex max-w-sm items-center gap-1.5 text-left"
              onClick={() => setEditingName(true)}
              type="button"
            >
              <h1 className="truncate text-sm font-semibold">{agent.name}</h1>
              <Pencil className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>
        <Badge variant="secondary">
          <span
            className={cn(
              'mr-1 size-1.5 rounded-full',
              agent.status === 'Ready' ? 'bg-emerald-500' : 'bg-amber-500'
            )}
          />
          {agent.status}
        </Badge>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-40 shrink-0 border-r bg-muted/15 p-2">
          <nav aria-label="Agent settings" className="flex flex-col gap-0.5">
            {AGENT_SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              return (
                <button
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    activeSection === section.id && 'bg-muted text-foreground'
                  )}
                  key={section.id}
                  onClick={() => {
                    setActiveSection(section.id);
                    setSessionOpen(false);
                  }}
                  type="button"
                >
                  <SectionIcon className="size-3.5" />
                  {section.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {activeSection === 'sessions' && sessionOpen ? (
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
              <Button variant="ghost" size="sm" onClick={() => setSessionOpen(false)}>
                <ArrowLeft data-icon="inline-start" /> Sessions
              </Button>
              <Separator className="mx-1 h-5" orientation="vertical" />
              <span className="truncate text-sm font-semibold">{sessionTitle}</span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
                {sessionMessages.map((message, index) => (
                  <div
                    className={cn(
                      'w-fit max-w-[80%] rounded-xl px-3 py-2 text-sm leading-5',
                      message.role === 'user'
                        ? 'ml-auto bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                    key={`${message.role}-${index}`}
                  >
                    {message.text}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <form
              className="shrink-0 border-t bg-background p-4"
              onSubmit={(event) => {
                event.preventDefault();
                sendSessionMessage();
              }}
            >
              <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background p-2 shadow-sm">
                <textarea
                  aria-label="Message"
                  className="min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={`Message ${agent.name}`}
                  rows={2}
                  value={sessionDraft}
                  onChange={(event) => setSessionDraft(event.target.value)}
                />
                <Button aria-label="Send message" size="icon" type="submit">
                  <Send />
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <ScrollArea className="min-w-0 flex-1">
            <div className="p-5 lg:p-7">
              {activeSection === 'general' && (
                <div className="mx-auto max-w-5xl space-y-7">
                  <MarkdownEditor value={description} onChange={setDescription} />
                  <FormSection
                    title="Provider"
                    description="Connect the provider, discover its available models, then verify the connection here."
                  >
                    <Card className="gap-4 bg-muted/20 p-4 shadow-none">
                      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium">Provider base URL</span>
                          <Input
                            aria-label="Provider base URL"
                            className="text-xs"
                            value={providerUrl}
                            onChange={(event) => {
                              setProviderUrl(event.target.value);
                              setProviderStatus('idle');
                            }}
                          />
                        </label>
                        <Field label="API key" value="••••••••••••••••••••" />
                      </div>
                      <div className="grid items-end gap-3 lg:grid-cols-[1fr_auto]">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium">Model</span>
                          <select
                            aria-label="Model"
                            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-ring/30"
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                          >
                            {models.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={fetchModels}
                          disabled={fetchingModels}
                        >
                          {fetchingModels ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <RefreshCw data-icon="inline-start" />
                          )}
                          {fetchingModels ? 'Fetching' : 'Fetch models'}
                        </Button>
                      </div>
                      <Separator />
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={testProvider}
                          disabled={providerStatus === 'testing'}
                        >
                          {providerStatus === 'testing' ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Play data-icon="inline-start" />
                          )}
                          {providerStatus === 'testing' ? 'Testing provider' : 'Test provider'}
                        </Button>
                        {providerStatus === 'connected' && (
                          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                            <Check className="size-3.5" /> Provider connected
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {models.length} model{models.length === 1 ? '' : 's'} available from this
                          URL
                        </span>
                      </div>
                    </Card>
                  </FormSection>
                  <div className="flex justify-end">
                    <SaveSectionButton />
                  </div>
                </div>
              )}

              {activeSection === 'system-prompt' && (
                <AgentSection
                  title="System prompt"
                  description="Define the standing instructions used at the start of every session."
                  action={<SaveSectionButton />}
                >
                  <textarea
                    aria-label="System prompt"
                    className="min-h-64 w-full resize-y rounded-lg border border-input bg-background p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/30"
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {systemPrompt.length} characters
                  </p>
                </AgentSection>
              )}

              {activeSection === 'tools' && (
                <AgentSection
                  title="Tools"
                  description="Choose the capabilities this agent may invoke during a run."
                  action={<SaveSectionButton />}
                >
                  {[
                    ['web_search', 'Search current public information'],
                    ['shell', 'Run approved local commands'],
                    ['read_file', 'Read files supplied to the agent'],
                  ].map(([name, description]) => (
                    <ToggleRow
                      key={name}
                      title={name}
                      description={description}
                      enabled={enabledTools.includes(name)}
                      onToggle={() => toggleValue(name, enabledTools, setEnabledTools)}
                    />
                  ))}
                </AgentSection>
              )}

              {activeSection === 'runtime' && (
                <AgentSection
                  title="Runtime"
                  description="Set the execution limits and local context for new sessions."
                  action={<SaveSectionButton />}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="Working directory"
                      value="~/.config/workflow/agents/support-analyst"
                    />
                    <Field label="Timeout" value="300" suffix="seconds" />
                    <Field label="Maximum turns" value="24" />
                    <Field label="Context window" value="Automatic" />
                  </div>
                </AgentSection>
              )}

              {activeSection === 'skills' && (
                <AgentSection
                  title="Skills"
                  description="Attach reusable instruction packages to this agent."
                  action={<ImportSkillFolderButton onImport={importSkillFolder} />}
                >
                  {skillNames.map((name) => (
                    <ToggleRow
                      key={name}
                      title={name}
                      description="Reusable instructions loaded only when this agent needs them."
                      enabled={enabledSkills.includes(name)}
                      onToggle={() => toggleValue(name, enabledSkills, setEnabledSkills)}
                    />
                  ))}
                </AgentSection>
              )}

              {activeSection === 'extensions' && (
                <AgentSection
                  title="Extensions"
                  description="Connect optional integrations to this agent."
                >
                  {['Git context', 'Issue tracker'].map((name) => (
                    <ToggleRow
                      key={name}
                      title={name}
                      description="Share scoped integration context with new sessions."
                      enabled={enabledExtensions.includes(name)}
                      onToggle={() => toggleValue(name, enabledExtensions, setEnabledExtensions)}
                    />
                  ))}
                </AgentSection>
              )}

              {activeSection === 'memories' && (
                <AgentSection
                  title="Memories"
                  description="Facts retained from this agent’s sessions through the configured mem0 server."
                  action={
                    <Button variant="outline" size="sm">
                      <RefreshCw data-icon="inline-start" /> Refresh
                    </Button>
                  }
                >
                  <div className="flex flex-col gap-2">
                    {[
                      ['Customer prefers concise status updates.', 'Updated 4 min ago'],
                      ['Escalate refund requests above $500 for human review.', 'Yesterday'],
                      ['Use the support knowledge base before web search.', '3 days ago'],
                    ].map(([memory, time]) => (
                      <Card className="gap-2 bg-muted/20 p-4 shadow-none" key={memory}>
                        <p className="text-sm leading-5">{memory}</p>
                        <span className="text-xs text-muted-foreground">{time}</span>
                      </Card>
                    ))}
                  </div>
                </AgentSection>
              )}

              {activeSection === 'sessions' && (
                <AgentSection
                  title="Sessions"
                  description="Recent runs started with this agent."
                  action={
                    <Button size="sm" onClick={startNewSession}>
                      <Plus data-icon="inline-start" /> New session
                    </Button>
                  }
                >
                  <div className="overflow-hidden rounded-xl border">
                    {[
                      ['Support request #1842', 'Completed', '4 min ago'],
                      ['Refund escalation', 'Completed', 'Yesterday'],
                      ['Account access review', 'Stopped', '2 days ago'],
                    ].map(([name, status, time]) => (
                      <button
                        className="group grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-6 border-b px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/40"
                        key={name}
                        onClick={() => openSession(name)}
                        type="button"
                      >
                        <span className="font-medium">{name}</span>
                        <Badge variant="outline">{status}</Badge>
                        <span className="text-xs text-muted-foreground">{time}</span>
                        <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </AgentSection>
              )}

              {activeSection === 'stats' && (
                <AgentSection
                  title="Statistics"
                  description="Performance and usage for this agent over the last 7 days."
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Runs" value="184" />
                    <Metric label="Success" value="98.1%" />
                    <Metric label="Median duration" value="12.4s" />
                    <Metric label="Tokens" value="1.2M" />
                  </div>
                  <Card className="mt-4 gap-3 bg-muted/20 p-4 shadow-none">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>Daily successful runs</span>
                      <Activity className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex h-36 items-end gap-3">
                      {[48, 65, 54, 78, 71, 88, 82].map((height, index) => (
                        <div
                          className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                          key={height}
                        >
                          <div
                            className="w-full rounded-t bg-primary/80"
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            {['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                </AgentSection>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

function AgentSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-start gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SaveSectionButton() {
  return (
    <Button size="sm">
      <Save data-icon="inline-start" /> Save changes
    </Button>
  );
}

function MarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const restoreSelection = (start: number, end: number) => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  };

  const wrapSelection = (prefix: string, suffix = prefix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd);
    onChange(
      `${value.slice(0, selectionStart)}${prefix}${selectedText}${suffix}${value.slice(
        selectionEnd
      )}`
    );
    restoreSelection(selectionStart + prefix.length, selectionEnd + prefix.length);
  };

  const makeList = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const lineStart = value.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
    const nextLineBreak = value.indexOf('\n', textarea.selectionEnd);
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    const selectedLines = value.slice(lineStart, lineEnd);
    const formatted = selectedLines
      .split('\n')
      .map((line) => `- ${line}`)
      .join('\n');
    onChange(`${value.slice(0, lineStart)}${formatted}${value.slice(lineEnd)}`);
    restoreSelection(lineStart, lineStart + formatted.length);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium" htmlFor="agent-description">
        Description
      </label>
      <div className="overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <div className="flex items-center gap-0.5 border-b bg-muted/25 p-1">
          <IconButton label="Bold" onClick={() => wrapSelection('**')}>
            <Bold />
          </IconButton>
          <IconButton label="Italic" onClick={() => wrapSelection('_')}>
            <Italic />
          </IconButton>
          <IconButton label="Inline code" onClick={() => wrapSelection('`')}>
            <Code2 />
          </IconButton>
          <IconButton label="Bulleted list" onClick={makeList}>
            <List />
          </IconButton>
          <span className="ml-auto pr-2 text-[10px] text-muted-foreground">Markdown</span>
        </div>
        <textarea
          ref={textareaRef}
          id="agent-description"
          aria-label="Description"
          className="min-h-24 w-full resize-y bg-transparent px-3 py-2 text-sm leading-5 outline-none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function ImportSkillFolderButton({ onImport }: { onImport: (files: FileList | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
    inputRef.current?.setAttribute('directory', '');
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="hidden"
        multiple
        type="file"
        onChange={(event) => {
          onImport(event.target.files);
          event.target.value = '';
        }}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <FolderUp data-icon="inline-start" /> Import folder
      </Button>
    </>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={enabled}
      className="mb-2 flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
      onClick={onToggle}
      type="button"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
        <Wrench className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span
        className={cn(
          'flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
          enabled ? 'justify-end bg-primary' : 'justify-start bg-muted-foreground/25'
        )}
      >
        <span className="size-4 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

function SettingsPage({ variant }: { variant: Variant }) {
  return (
    <div className="mx-auto min-h-full max-w-[980px] p-6 lg:p-8">
      <div className="mb-4 flex justify-end">
        <Button>
          <Save data-icon="inline-start" /> Save settings
        </Button>
      </div>
      <div className={cn('grid gap-4', variant === 'B' ? 'md:grid-cols-2' : 'grid-cols-1')}>
        <SettingsCard
          icon={Clock3}
          title="Execution"
          description="Control the default limits applied to every workflow run."
        >
          <Field label="Node timeout" value="300" suffix="seconds" />
          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
            A running node is cancelled after this limit. Individual node behavior and workflow
            execution semantics remain unchanged.
          </div>
        </SettingsCard>
        <SettingsCard
          icon={Database}
          title="Memory (mem0)"
          description="Configure persistent Agent memory and the models used to extract and search it."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Server URL" value="http://localhost:8890" />
            <Field label="API key" value="••••••••••••••••••••" />
            <Field label="Admin key" value="••••••••••••" />
            <Field label="LLM base URL" value="https://api.example.com" />
            <Field label="LLM model" value="deepseek-v4-flash" />
            <Field label="Embedding model" value="text-embedding-v4" />
            <Field label="Embedding dimensions" value="1024" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Radio data-icon="inline-start" /> Test connection
            </Button>
            <span className="text-xs text-muted-foreground">
              Saved credentials stay on the backend proxy.
            </span>
          </div>
        </SettingsCard>
        <SettingsCard
          icon={Archive}
          title="Local data"
          description="Understand where workflows, agents and run history are stored."
        >
          <div className="rounded-lg border bg-muted/30 p-3 font-mono text-xs">
            ~/.config/workflow/workflow.db
          </div>
          <Button className="w-fit" variant="outline" size="sm">
            <ExternalLink data-icon="inline-start" /> Open data directory
          </Button>
        </SettingsCard>
        <SettingsCard
          icon={Cloud}
          title="Environment"
          description="Current application runtime information."
        >
          <KeyValue label="Mode" value="Development" />
          <KeyValue label="API origin" value="Same origin" />
          <KeyValue label="Provider" value="Fake provider :4010" />
        </SettingsCard>
      </div>
    </div>
  );
}

function EditorCanvas({
  variant,
  running,
  selectedNode,
  onSelectNode,
}: {
  variant: Variant;
  running: boolean;
  selectedNode: CanvasNodeId | null;
  onSelectNode: (nodeId: CanvasNodeId | null) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    nodeId: CanvasNodeId;
    pointerId: number;
    startX: number;
    startY: number;
    origin: CanvasPosition;
    moved: boolean;
  } | null>(null);
  const [positions, setPositions] = useState(INITIAL_NODE_POSITIONS);
  const [edgePaths, setEdgePaths] = useState<Array<{ key: string; d: string; active?: boolean }>>(
    []
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updatePaths = () => {
      const canvasRect = canvas.getBoundingClientRect();
      setEdgePaths(
        CANVAS_EDGES.flatMap((edge) => {
          const source = canvas.querySelector<HTMLElement>(`[data-node-id="${edge.source}"]`);
          const target = canvas.querySelector<HTMLElement>(`[data-node-id="${edge.target}"]`);
          if (!source || !target) return [];

          const sourceRect = source.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const sourceCenterX = sourceRect.left - canvasRect.left + sourceRect.width / 2;
          const sourceCenterY = sourceRect.top - canvasRect.top + sourceRect.height / 2;
          const targetCenterX = targetRect.left - canvasRect.left + targetRect.width / 2;
          const targetCenterY = targetRect.top - canvasRect.top + targetRect.height / 2;
          const verticallyAligned =
            Math.abs(targetCenterX - sourceCenterX) < sourceRect.width * 0.55;

          let d: string;
          if (verticallyAligned) {
            const targetIsBelow = targetCenterY > sourceCenterY;
            const x1 = sourceCenterX;
            const y1 = targetIsBelow
              ? sourceRect.bottom - canvasRect.top
              : sourceRect.top - canvasRect.top;
            const x2 = targetCenterX;
            const y2 = targetIsBelow
              ? targetRect.top - canvasRect.top
              : targetRect.bottom - canvasRect.top;
            const bend = Math.max(42, Math.abs(y2 - y1) * 0.42);
            d = `M ${x1} ${y1} C ${x1} ${y1 + (targetIsBelow ? bend : -bend)}, ${x2} ${
              y2 + (targetIsBelow ? -bend : bend)
            }, ${x2} ${y2}`;
          } else {
            const x1 = sourceRect.right - canvasRect.left;
            const y1 = sourceCenterY;
            const x2 = targetRect.left - canvasRect.left;
            const y2 = targetCenterY;
            const bend = Math.max(42, Math.abs(x2 - x1) * 0.42);
            d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
          }

          return [
            {
              key: `${edge.source}-${edge.target}`,
              d,
              active: edge.active,
            },
          ];
        })
      );
    };

    const frame = window.requestAnimationFrame(updatePaths);
    const observer = new ResizeObserver(updatePaths);
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [positions, selectedNode, variant]);

  const beginDrag = (nodeId: CanvasNodeId, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      nodeId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: positions[nodeId],
      moved: false,
    };
  };

  const moveNode = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas || drag.pointerId !== event.pointerId) return;

    const canvasRect = canvas.getBoundingClientRect();
    const cardRect = event.currentTarget.getBoundingClientRect();
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.moved = true;

    const maxX = Math.max(1, 99 - (cardRect.width / canvasRect.width) * 100);
    const halfHeight = (cardRect.height / canvasRect.height) * 50;
    const nextX = Math.min(maxX, Math.max(1, drag.origin.x + (deltaX / canvasRect.width) * 100));
    const nextY = Math.min(
      99 - halfHeight,
      Math.max(halfHeight + 1, drag.origin.y + (deltaY / canvasRect.height) * 100)
    );

    setPositions((current) => ({ ...current, [drag.nodeId]: { x: nextX, y: nextY } }));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (!drag.moved) onSelectNode(drag.nodeId === 'llm' ? 'llm' : null);
  };

  return (
    <div
      ref={canvasRef}
      className={cn(
        'workflow-canvas relative h-full min-h-[680px] overflow-hidden',
        variant === 'B' && 'min-h-[560px]'
      )}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelectNode(null);
      }}
    >
      {variant === 'C' && <NodeLibrary />}
      <CanvasToolbar variant={variant} />
      <svg className="pointer-events-none absolute inset-0 size-full">
        {edgePaths.map((edge) => (
          <path
            className={cn('flow-line', edge.active && running && 'active')}
            d={edge.d}
            key={edge.key}
          />
        ))}
      </svg>
      <div className={cn('absolute inset-0', variant === 'C' && 'left-[252px]')}>
        <NodeCard
          id="start"
          kind="start"
          title="Start"
          subtitle="When workflow is run"
          position={positions.start}
          status="Ready"
          onPointerDown={beginDrag}
          onPointerMove={moveNode}
          onPointerUp={finishDrag}
        >
          <VariableBinding label="Output" value="request" />
        </NodeCard>
        <NodeCard
          id="llm"
          kind="llm"
          title="Analyze request"
          subtitle="Support analyst"
          position={positions.llm}
          status={running ? 'Running' : 'Ready'}
          active={running}
          selected={selectedNode === 'llm'}
          onPointerDown={beginDrag}
          onPointerMove={moveNode}
          onPointerUp={finishDrag}
          onOpen={() => onSelectNode('llm')}
        >
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            Classify the request, extract urgency and prepare a concise response outline.
          </p>
          <VariableBinding label="Input" value="start.request" />
        </NodeCard>
        <NodeCard
          id="condition"
          kind="condition"
          title="Route by urgency"
          subtitle="3 branches"
          position={positions.condition}
          status="Configured"
          onPointerDown={beginDrag}
          onPointerMove={moveNode}
          onPointerUp={finishDrag}
        >
          <VariableBinding label="Input" value="analyze_request.priority" />
          <div className="flex flex-col gap-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span>Urgent</span>
              <Badge variant="outline">P0/P1</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Standard</span>
              <Badge variant="outline">P2/P3</Badge>
            </div>
          </div>
        </NodeCard>
        <NodeCard
          id="http"
          kind="http"
          title="Create ticket"
          subtitle="POST /tickets"
          position={positions.http}
          status="Ready"
          onPointerDown={beginDrag}
          onPointerMove={moveNode}
          onPointerUp={finishDrag}
        >
          <VariableBinding label="payload" value="route_by_urgency.ticket" />
        </NodeCard>
        <NodeCard
          id="end"
          kind="end"
          title="Human review"
          subtitle="Return final output"
          position={positions.end}
          status="Ready"
          onPointerDown={beginDrag}
          onPointerMove={moveNode}
          onPointerUp={finishDrag}
        >
          <VariableBinding label="result" value="route_by_urgency.review" />
        </NodeCard>
      </div>
      {variant === 'A' && (
        <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-sm">
          <Button variant="ghost" size="icon-sm">
            <Plus />
          </Button>
          <span className="min-w-12 text-center text-xs text-muted-foreground">100%</span>
          <Button variant="ghost" size="icon-sm">
            <RotateCcw />
          </Button>
          <Button variant="ghost" size="icon-sm">
            <Maximize2 />
          </Button>
        </div>
      )}
      {running && (
        <div className="absolute right-4 bottom-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 shadow-sm dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          <LoaderCircle className="size-3.5 animate-spin" /> Executing “Analyze request”
        </div>
      )}
    </div>
  );
}

function CanvasToolbar({ variant }: { variant: Variant }) {
  return (
    <div
      className={cn(
        'absolute top-4 z-20 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-sm',
        variant === 'C' ? 'left-[268px]' : 'left-4'
      )}
    >
      {variant !== 'C' && (
        <Button variant="ghost" size="sm">
          <Plus data-icon="inline-start" /> Add node
        </Button>
      )}
      <IconButton label="Select tool">
        <TextCursorInput />
      </IconButton>
      <IconButton label="Auto layout">
        <WandSparkles />
      </IconButton>
      <Separator className="mx-0.5 h-5" orientation="vertical" />
      <IconButton label="Horizontal layout">
        <Columns3 />
      </IconButton>
      <IconButton label="Fit view">
        <Maximize2 />
      </IconButton>
    </div>
  );
}

function NodeCard({
  id,
  kind,
  title,
  subtitle,
  status,
  position,
  active,
  selected,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onOpen,
}: {
  id: CanvasNodeId;
  kind: 'start' | 'llm' | 'condition' | 'http' | 'end';
  title: string;
  subtitle: string;
  status: string;
  position: CanvasPosition;
  active?: boolean;
  selected?: boolean;
  children?: ReactNode;
  onPointerDown: (nodeId: CanvasNodeId, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onOpen?: () => void;
}) {
  const config = {
    start: { icon: Radio, tone: 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-950' },
    llm: { icon: Sparkles, tone: 'bg-blue-600 text-white' },
    condition: { icon: GitBranch, tone: 'bg-amber-500 text-white' },
    http: { icon: Webhook, tone: 'bg-violet-600 text-white' },
    end: { icon: Check, tone: 'bg-emerald-600 text-white' },
  }[kind];
  const NodeIcon = config.icon;

  return (
    <Card
      aria-label={`${title} node${kind === 'llm' ? '. Click to configure' : ''}`}
      className={cn(
        'node-card absolute w-[180px] touch-none gap-3 border-border/90 bg-card p-3 shadow-[0_4px_16px_rgb(15_23_42/0.08)] select-none',
        active && 'border-blue-400 ring-2 ring-blue-500/15',
        selected && 'border-primary ring-2 ring-primary/15'
      )}
      data-node-id={id}
      role="button"
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (kind === 'llm' && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen?.();
        }
      }}
      onPointerDown={(event) => onPointerDown(id, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="node-port -left-1.5" />
      <span className="node-port -right-1.5" />
      <span className="node-port-y -top-1.5" />
      <span className="node-port-y -bottom-1.5" />
      <div className="flex items-start gap-2.5">
        <span
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', config.tone)}
        >
          <NodeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-xs font-semibold">{title}</h3>
            <GripVertical className="ml-auto size-3.5 text-muted-foreground/60" />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 rounded-full',
              active ? 'animate-pulse bg-blue-500' : 'bg-emerald-500'
            )}
          />
          {status}
        </span>
        <MoreHorizontal className="size-3.5" />
      </div>
    </Card>
  );
}

function VariableBinding({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[10px] text-muted-foreground">
      <Variable className="size-3 shrink-0" />
      <span className="shrink-0">{label}</span>
      <span className="truncate font-mono text-foreground">{value}</span>
    </div>
  );
}

function Inspector({ variant, onClose }: { variant: 'A' | 'C'; onClose: () => void }) {
  const [prompt, setPrompt] = useState(
    'Classify {{start.request}} by urgency.\n\nReturn a summary, priority and review decision.'
  );
  const [variablePickerOpen, setVariablePickerOpen] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>('fields');
  const [outputFields, setOutputFields] = useState<OutputField[]>([
    { id: 1, key: 'summary', type: 'string' },
    { id: 2, key: 'priority', type: 'string' },
    { id: 3, key: 'requires_review', type: 'boolean' },
  ]);
  const [jsonSchema, setJsonSchema] = useState(`{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "priority": { "type": "string", "enum": ["low", "medium", "high"] },
    "requires_review": { "type": "boolean" }
  },
  "required": ["summary", "priority", "requires_review"]
}`);

  const jsonSchemaKeys = useMemo(() => {
    try {
      const schema = JSON.parse(jsonSchema) as { properties?: Record<string, unknown> };
      return Object.keys(schema.properties ?? {});
    } catch {
      return [];
    }
  }, [jsonSchema]);

  const outputPaths =
    outputMode === 'fields'
      ? outputFields.map((field) => field.key.trim()).filter(Boolean)
      : jsonSchemaKeys;

  const updateOutputField = (id: number, patch: Partial<OutputField>) => {
    setOutputFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  };

  const insertVariable = (variable: string) => {
    setPrompt((current) => `${current}${current.endsWith(' ') ? '' : ' '}{{${variable}}}`);
    setVariablePickerOpen(false);
  };

  const content = (
    <>
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div>
          <div className="text-xs font-semibold">Analyze request</div>
          <div className="text-[11px] text-muted-foreground">LLM node</div>
        </div>
        <Badge className="ml-auto" variant="secondary">
          Ready
        </Badge>
        <Button aria-label="Close node settings" variant="ghost" size="icon-xs" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ScrollArea className="h-[calc(100%-56px)]">
        <div className="flex flex-col gap-5 p-4">
          <FormSection
            title="Run with agent"
            description="Choose the reusable Agent profile that will execute this node."
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Agent</span>
              <button
                aria-label="Selected agent: Support analyst"
                className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left"
                type="button"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-blue-600 text-white">
                  <Bot className="size-3.5" />
                </span>
                <span className="flex-1 text-xs font-medium">Support analyst</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Inherits this Agent’s model, system prompt, tools, skills and runtime settings.
              </p>
            </div>
          </FormSection>
          <FormSection
            title="Prompt"
            description="Reference values from upstream nodes or global workflow variables."
          >
            <textarea
              aria-label="Node prompt"
              className="min-h-40 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/30"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-primary"
              onClick={() => setVariablePickerOpen((current) => !current)}
              type="button"
            >
              <Braces className="size-3.5" /> Insert variable
            </button>
            {variablePickerOpen && (
              <Card className="gap-3 bg-muted/20 p-3 shadow-none">
                {[
                  ['Upstream nodes', ['start.request']],
                  ['Global variables', ['global.current_user', 'global.environment']],
                ].map(([group, variables]) => (
                  <div className="flex flex-col gap-1.5" key={group as string}>
                    <span className="text-[10px] font-medium text-muted-foreground">{group}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {(variables as string[]).map((variable) => (
                        <Button
                          key={variable}
                          variant="outline"
                          size="xs"
                          onClick={() => insertVariable(variable)}
                        >
                          <Variable data-icon="inline-start" /> {variable}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </FormSection>
          <FormSection
            title="Structured output"
            description="Define the JSON object this Agent must return for downstream nodes."
          >
            <Tabs value={outputMode} onValueChange={(value) => setOutputMode(value as OutputMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="fields">
                  <ListPlus data-icon="inline-start" /> Simple
                </TabsTrigger>
                <TabsTrigger value="json">
                  <FileJson2 data-icon="inline-start" /> JSON Schema
                </TabsTrigger>
              </TabsList>
              <TabsContent className="flex flex-col gap-2" value="fields">
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Name each key; the Agent fills its value at runtime.
                </p>
                {outputFields.map((field, index) => (
                  <div
                    className="grid grid-cols-[1fr_92px_28px] items-center gap-1.5"
                    key={field.id}
                  >
                    <Input
                      aria-label={`Output key ${index + 1}`}
                      className="font-mono text-xs"
                      placeholder="field_name"
                      value={field.key}
                      onChange={(event) => updateOutputField(field.id, { key: event.target.value })}
                    />
                    <select
                      aria-label={`Output type ${index + 1}`}
                      className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring/30"
                      value={field.type}
                      onChange={(event) =>
                        updateOutputField(field.id, {
                          type: event.target.value as OutputField['type'],
                        })
                      }
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                    </select>
                    <Button
                      aria-label={`Remove output ${field.key || index + 1}`}
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setOutputFields((current) => current.filter((item) => item.id !== field.id))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  className="w-fit"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOutputFields((current) => [
                      ...current,
                      {
                        id: Math.max(0, ...current.map((field) => field.id)) + 1,
                        key: '',
                        type: 'string',
                      },
                    ])
                  }
                >
                  <Plus data-icon="inline-start" /> Add key
                </Button>
              </TabsContent>
              <TabsContent className="flex flex-col gap-2" value="json">
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Provide a JSON Schema when nested objects, arrays or strict enums are required.
                </p>
                <textarea
                  aria-label="JSON output schema"
                  className="min-h-64 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-[11px] leading-5 outline-none focus:ring-2 focus:ring-ring/30"
                  spellCheck={false}
                  value={jsonSchema}
                  onChange={(event) => setJsonSchema(event.target.value)}
                />
              </TabsContent>
            </Tabs>
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/20 p-3">
              <span className="text-[10px] font-medium text-muted-foreground uppercase">
                Downstream paths
              </span>
              {outputPaths.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">No valid output keys yet.</span>
              ) : (
                outputPaths.map((key) => (
                  <code className="text-[11px]" key={key}>
                    analyze_request.{key}
                  </code>
                ))
              )}
            </div>
          </FormSection>
        </div>
      </ScrollArea>
    </>
  );

  if (variant === 'C') {
    return (
      <Card className="absolute top-[72px] right-4 z-30 h-[calc(100%-104px)] w-[360px] gap-0 overflow-hidden p-0 shadow-[0_18px_48px_rgb(15_23_42/0.16)]">
        {content}
      </Card>
    );
  }

  return (
    <aside className="w-[380px] shrink-0 p-3">
      <Card className="h-full gap-0 overflow-hidden rounded-2xl p-0 shadow-lg">{content}</Card>
    </aside>
  );
}

function NodeLibrary() {
  return (
    <aside className="absolute inset-y-0 left-0 z-10 w-[252px] border-r bg-background">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <span className="text-xs font-semibold">Node library</span>
        <Button variant="ghost" size="icon-xs">
          <PanelLeftClose />
        </Button>
      </div>
      <div className="p-3">
        <div className="relative mb-3">
          <Search className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
          <Input className="h-8 pl-8 text-xs" placeholder="Find a node" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {NODE_TYPES.map(([name, IconComponent]) => (
            <button
              className="flex min-h-16 flex-col items-start justify-between rounded-lg border border-border/70 bg-card p-2 text-left hover:border-foreground/20 hover:bg-muted/40"
              key={name}
              type="button"
            >
              <IconComponent className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium">{name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ExecutionDock({ running }: { running: boolean }) {
  return (
    <div className="grid h-[132px] shrink-0 grid-cols-[220px_1fr_260px] border-t bg-background">
      <div className="border-r p-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Activity className="size-3.5" /> Execution
          <Badge className="ml-auto" variant={running ? 'secondary' : 'outline'}>
            {running ? 'Running' : 'Idle'}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Nodes" value={running ? '2 / 5' : '—'} />
          <Metric label="Duration" value={running ? '1.4s' : '—'} />
        </div>
      </div>
      <div className="border-r p-3 font-mono text-[11px] leading-5 text-muted-foreground">
        <div>
          <span className="text-foreground">10:42:08</span> Workflow ready
        </div>
        {running && (
          <>
            <div>
              <span className="text-foreground">10:42:09</span> Start completed
            </div>
            <div className="text-blue-600 dark:text-blue-300">
              <span>10:42:09</span> Analyze request · streaming content…
            </div>
          </>
        )}
        {!running && <div>Select “Run” to stream node events here.</div>}
      </div>
      <div className="p-3">
        <div className="text-xs font-semibold">Run controls</div>
        <div className="mt-3 flex gap-2">
          <Button className="flex-1" variant="outline" size="sm">
            <CircleStop data-icon="inline-start" /> Stop
          </Button>
          <Button className="flex-1" variant="outline" size="sm">
            <RotateCcw data-icon="inline-start" /> Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold">{title}</h3>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  multiline,
  suffix,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  suffix?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      <div className="relative">
        {multiline ? (
          <textarea
            className="min-h-20 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring/30"
            defaultValue={value}
          />
        ) : (
          <Input className={cn('text-xs', suffix && 'pr-20')} defaultValue={value} />
        )}
        {suffix && (
          <span className="absolute top-2 right-3 text-xs text-muted-foreground">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function SettingsCard({
  icon: IconComponent,
  title,
  description,
  children,
}: {
  icon: Icon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-5 p-5 shadow-none">
      <div className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/50">
          <IconComponent className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <Separator />
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xs font-semibold">{value}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <button
      className={cn('flex h-14 shrink-0 items-center gap-2.5 px-4 text-left', compact && 'px-0')}
      type="button"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
        <Zap className="size-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-[-0.02em]">Workflow</span>
        {!compact && (
          <span className="block text-[10px] text-muted-foreground">Agent orchestration</span>
        )}
      </span>
    </button>
  );
}

function RailNavItem({
  active,
  collapsed,
  icon: IconComponent,
  label,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  icon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
          collapsed && 'justify-center px-0',
          active && 'bg-accent font-medium text-foreground'
        )}
        onClick={onClick}
      >
        <IconComponent className="size-4" /> {!collapsed && label}
      </TooltipTrigger>
      <TooltipContent side="right" hidden={!collapsed}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  label,
  children,
  onClick,
  className,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), className)}
        onClick={onClick}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  return (
    <IconButton
      className="text-muted-foreground/45 hover:text-muted-foreground"
      label={dark ? 'Use light theme' : 'Use dark theme'}
      onClick={() => setDark(!dark)}
    >
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

function VariantSwitcher({
  variant,
  onChange,
}: {
  variant: Variant;
  onChange: (variant: Variant) => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background p-1.5 shadow-[0_16px_44px_rgb(15_23_42/0.18)]">
      <Badge className="mr-1" variant="outline">
        Prototype
      </Badge>
      {VARIANTS.map((item) => (
        <Tooltip key={item.id}>
          <TooltipTrigger
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
              variant === item.id &&
                'bg-foreground text-background hover:bg-foreground hover:text-background'
            )}
            onClick={() => onChange(item.id)}
          >
            <kbd
              className={cn(
                'flex size-5 items-center justify-center rounded border text-[10px]',
                variant === item.id ? 'border-background/25' : 'border-border bg-muted'
              )}
            >
              {item.id}
            </kbd>
            <span className="hidden sm:inline">{item.name}</span>
          </TooltipTrigger>
          <TooltipContent>{item.description} · use ← →</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
