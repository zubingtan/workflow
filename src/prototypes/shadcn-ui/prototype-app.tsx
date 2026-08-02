import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';

import {
  Activity,
  AlignHorizontalSpaceAround,
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Braces,
  Check,
  ChevronDown,
  CircleStop,
  Clock3,
  Cloud,
  Code2,
  Columns3,
  Database,
  Ellipsis,
  ExternalLink,
  FileClock,
  GitBranch,
  Globe2,
  GripVertical,
  History,
  LoaderCircle,
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
  Undo2,
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
    agentTransition,
    onOpenAgent: openAgent,
    onCloseAgent: closeAgent,
    onOpenWorkflow: openWorkflow,
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
  agentTransition: StackTransition;
  onOpenAgent: (index: number) => void;
  onCloseAgent: () => void;
  onOpenWorkflow: (name: string) => void;
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
              <PanelLeftClose className="rotate-180" />
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
                <PanelLeftClose />
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
          {view === 'editor' && <Inspector variant="A" />}
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
        <IconButton label="More options">
          <Ellipsis />
        </IconButton>
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
        {view === 'editor' && <Inspector variant="C" />}
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
      return <EditorCanvas variant={props.variant} running={props.running} />;
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
  { id: 'sessions', label: 'Sessions', icon: History },
  { id: 'stats', label: 'Stats', icon: Activity },
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
  const [enabledTools, setEnabledTools] = useState(['web_search', 'read_file']);
  const [enabledSkills, setEnabledSkills] = useState(['Support triage']);
  const [enabledExtensions, setEnabledExtensions] = useState(['Git context']);
  const [activeSection, setActiveSection] = useState<AgentSectionId>('general');
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState('');
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
    setSessionMessages([{ role: 'assistant', text: 'Hi — what would you like to work on?' }]);
    setSessionDraft('');
    setSessionOpen(true);
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
            <Button className="ml-auto" size="sm">
              <Plus data-icon="inline-start" /> New agent
            </Button>
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
              <Badge variant={item.status === 'Ready' ? 'secondary' : 'outline'}>
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
            'flex size-8 shrink-0 items-center justify-center rounded-lg text-white',
            agent.color
          )}
        >
          <Bot className="size-4" />
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
        <Button className="ml-auto" variant="ghost" size="sm">
          Discard
        </Button>
        <Button size="sm">
          <Save data-icon="inline-start" /> Save agent
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 border-r bg-muted/15 p-2">
          <nav aria-label="Agent settings" className="space-y-1">
            {AGENT_SECTIONS.map((section) => {
              const SectionIcon = section.icon;
              return (
                <button
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
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
              <span className="text-sm font-semibold">New session</span>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
                <div className="mb-8 flex flex-col items-center text-center">
                  <span
                    className={cn(
                      'flex size-11 items-center justify-center rounded-xl text-white',
                      agent.color
                    )}
                  >
                    <Bot className="size-5" />
                  </span>
                  <h2 className="mt-3 text-base font-semibold">{agent.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">New agent session</p>
                </div>
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
                  <Field
                    label="Description"
                    value="Analyzes incoming support requests and prepares a grounded response for human review."
                    multiline
                  />
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
                </div>
              )}

              {activeSection === 'system-prompt' && (
                <AgentSection
                  title="System prompt"
                  description="Define the standing instructions used at the start of every session."
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
                >
                  {['Support triage', 'Source verification', 'Response editor'].map((name) => (
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
                  {['Git context', 'mem0 memory', 'Issue tracker'].map((name) => (
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
                      <div
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-6 border-b px-4 py-3 text-sm last:border-b-0"
                        key={name}
                      >
                        <span className="font-medium">{name}</span>
                        <Badge variant="outline">{status}</Badge>
                        <span className="text-xs text-muted-foreground">{time}</span>
                      </div>
                    ))}
                  </div>
                </AgentSection>
              )}

              {activeSection === 'stats' && (
                <AgentSection
                  title="Stats"
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
          title="Memory"
          description="Connect the application to a compatible mem0 server."
        >
          <Field label="Server URL" value="http://localhost:8080" />
          <Field label="API key" value="••••••••••••••••••••" />
          <button
            className="flex items-center gap-1.5 text-xs font-medium text-primary"
            type="button"
          >
            <Radio className="size-3.5" /> Test connection
          </button>
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

function EditorCanvas({ variant, running }: { variant: Variant; running: boolean }) {
  return (
    <div
      className={cn(
        'workflow-canvas relative h-full min-h-[680px] overflow-hidden',
        variant === 'B' && 'min-h-[560px]'
      )}
    >
      {variant === 'C' && <NodeLibrary />}
      <CanvasToolbar variant={variant} />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 650"
      >
        <path className="flow-line" d="M 155 316 C 220 316, 200 213, 275 213" />
        <path className="flow-line active" d="M 455 213 C 520 213, 510 325, 570 325" />
        <path className="flow-line" d="M 765 325 C 825 325, 805 218, 870 218" />
        <path className="flow-line" d="M 668 390 C 668 462, 818 464, 872 464" />
      </svg>
      <div className={cn('absolute inset-0', variant === 'C' && 'left-[252px]')}>
        <NodeCard
          kind="start"
          title="Start"
          subtitle="When workflow is run"
          x="7%"
          y="43%"
          status="Ready"
        />
        <NodeCard
          kind="llm"
          title="Analyze request"
          subtitle="Support analyst"
          x="26%"
          y="21%"
          status={running ? 'Running' : 'Ready'}
          active={running}
        >
          <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            Classify the request, extract urgency and prepare a concise response outline.
          </p>
        </NodeCard>
        <NodeCard
          kind="condition"
          title="Route by urgency"
          subtitle="3 branches"
          x="53%"
          y="39%"
          status="Configured"
        >
          <div className="space-y-1.5 text-[11px]">
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
          kind="http"
          title="Create ticket"
          subtitle="POST /tickets"
          x="79%"
          y="22%"
          status="Ready"
        >
          <div className="rounded-md bg-muted px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
            api.internal.dev
          </div>
        </NodeCard>
        <NodeCard
          kind="end"
          title="Human review"
          subtitle="Return final output"
          x="80%"
          y="66%"
          status="Ready"
        />
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
  kind,
  title,
  subtitle,
  status,
  x,
  y,
  active,
  children,
}: {
  kind: 'start' | 'llm' | 'condition' | 'http' | 'end';
  title: string;
  subtitle: string;
  status: string;
  x: string;
  y: string;
  active?: boolean;
  children?: ReactNode;
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
      className={cn(
        'node-card absolute w-[210px] gap-3 border-border/90 bg-card p-3 shadow-[0_4px_16px_rgb(15_23_42/0.08)]',
        active && 'border-blue-400 ring-2 ring-blue-500/15'
      )}
      style={{ left: x, top: y }}
    >
      <span className="node-port -left-1.5" />
      <span className="node-port -right-1.5" />
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

function Inspector({ variant }: { variant: 'A' | 'C' }) {
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
        {variant === 'C' && (
          <Button variant="ghost" size="icon-xs">
            <X />
          </Button>
        )}
      </div>
      <ScrollArea className="h-[calc(100%-56px)]">
        <div className="space-y-5 p-4">
          <FormSection title="Agent" description="Execution identity for this node.">
            <label className="space-y-1.5">
              <span className="text-xs font-medium">Selected agent</span>
              <button
                className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left"
                type="button"
              >
                <span className="flex size-7 items-center justify-center rounded-md bg-blue-600 text-white">
                  <Bot className="size-3.5" />
                </span>
                <span className="flex-1 text-xs font-medium">Support analyst</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </label>
          </FormSection>
          <FormSection title="Prompt" description="Variables remain compatible with Workflow JSON.">
            <textarea
              className="min-h-40 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-ring/30"
              defaultValue={
                'Classify {{input.request}} by urgency.\n\nReturn a summary, risk level and response outline.'
              }
            />
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-primary"
              type="button"
            >
              <Braces className="size-3.5" /> Insert variable
            </button>
          </FormSection>
          <FormSection title="Output" description="Available to downstream nodes.">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-[11px]">
              analyze_request.output
            </div>
          </FormSection>
        </div>
      </ScrollArea>
    </>
  );

  if (variant === 'C') {
    return (
      <Card className="absolute top-[72px] right-4 z-30 h-[calc(100%-104px)] w-[304px] gap-0 overflow-hidden p-0 shadow-[0_18px_48px_rgb(15_23_42/0.16)]">
        {content}
      </Card>
    );
  }

  return (
    <aside className="w-[340px] shrink-0 p-3">
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
