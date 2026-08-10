import * as React from 'react';

import { Check, LoaderCircle, X } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  Dialog as BaseDialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button as BaseButton } from './button';

type InputChange = (value: string) => void;

export function Input({
  onChange,
  onEnterPress,
  onKeyDown,
  mode,
  prefix,
  size,
  showClear,
  style,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size' | 'prefix'> & {
  onChange?: InputChange;
  onEnterPress?: () => void;
  mode?: 'password';
  prefix?: React.ReactNode;
  size?: 'small' | 'default';
  showClear?: boolean;
}) {
  const showClearButton = showClear && typeof props.value === 'string' && props.value.length > 0;
  const input = (
    <input
      {...(props as React.InputHTMLAttributes<HTMLInputElement>)}
      type={mode === 'password' ? 'password' : props.type}
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'small' && 'h-7 text-xs',
        showClearButton && 'pr-8',
        props.className
      )}
      style={style}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnterPress?.();
        onKeyDown?.(event);
      }}
    />
  );

  return prefix || showClear ? (
    <span className="relative block">
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground">
        {prefix}
      </span>
      {React.cloneElement(input, {
        className: cn(input.props.className, prefix && 'pl-8'),
      })}
      {showClearButton && (
        <button
          type="button"
          aria-label="Clear"
          className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
          onClick={() => onChange?.('')}
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  ) : (
    input
  );
}

type ManagementButtonProps = Omit<
  React.ComponentProps<typeof BaseButton>,
  'variant' | 'size' | 'type'
> & {
  theme?: 'solid' | 'borderless' | 'light' | 'outline';
  type?: 'primary' | 'danger' | 'default';
  size?: 'small' | 'default';
  loading?: boolean;
  icon?: React.ReactNode;
};

export function Button({
  theme,
  type,
  size,
  loading,
  icon,
  children,
  disabled,
  ...props
}: ManagementButtonProps) {
  const variant =
    type === 'danger'
      ? 'destructive'
      : theme === 'borderless'
      ? 'ghost'
      : theme === 'light'
      ? 'secondary'
      : 'default';
  return (
    <BaseButton
      {...props}
      variant={variant}
      size={size === 'small' ? 'sm' : 'default'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <LoaderCircle className="animate-spin" /> : icon}
      {children}
    </BaseButton>
  );
}

type TextProps = React.HTMLAttributes<HTMLElement> & {
  type?: 'default' | 'tertiary' | 'success' | 'danger';
  size?: 'small' | 'default';
  strong?: boolean;
};

function textClass({ type = 'default', size = 'default', strong = false }: TextProps) {
  return cn(
    type === 'tertiary' && 'text-muted-foreground',
    type === 'success' && 'text-emerald-600 dark:text-emerald-400',
    type === 'danger' && 'text-destructive',
    size === 'small' && 'text-xs',
    strong && 'font-semibold'
  );
}

function Text({ type, size, strong, className, ...props }: TextProps) {
  return <span className={cn(textClass({ type, size, strong }), className)} {...props} />;
}

function Title({
  heading = 3,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { heading?: number }) {
  const Tag = `h${Math.min(6, Math.max(1, heading))}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return React.createElement(Tag, {
    className: cn('font-semibold tracking-tight', className),
    ...props,
  });
}

function Paragraph({ type, size, strong, className, ...props }: TextProps) {
  return <p className={cn(textClass({ type, size, strong }), className)} {...props} />;
}

export const Typography = { Text, Title, Paragraph };

export function Spin({
  className,
  style,
  size,
}: {
  className?: string;
  style?: React.CSSProperties;
  size?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-flex text-primary', className)}
      style={style}
    >
      <LoaderCircle className={cn('animate-spin', size === 'large' ? 'size-6' : 'size-4')} />
    </span>
  );
}

export function Empty({
  description,
  className,
  style,
}: {
  description?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        'flex min-h-24 items-center justify-center p-6 text-sm text-muted-foreground',
        className
      )}
      style={style}
    >
      {description}
    </div>
  );
}

const TAG_COLORS: Record<string, string> = {
  blue: 'bg-primary/10 text-primary',
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  red: 'bg-destructive/10 text-destructive',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  grey: 'bg-muted text-muted-foreground',
};

export function Tag({
  children,
  color = 'grey',
  closable,
  onClose,
  size,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  color?: string;
  closable?: boolean;
  onClose?: () => void;
  size?: 'small' | 'large';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
        TAG_COLORS[color] ?? 'bg-muted text-muted-foreground',
        size === 'large' && 'px-2.5 py-1',
        className
      )}
      {...props}
    >
      {children}
      {closable && (
        <button
          type="button"
          aria-label="Remove"
          className="rounded-full p-0.5 hover:bg-black/10"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
}

type ToastKind = 'success' | 'error' | 'warning' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string };
let nextToastId = 0;
const toastListenersKey = '__workflowManagementToastListeners';
const toastListeners = ((
  globalThis as typeof globalThis & {
    __workflowManagementToastListeners?: Set<(item: ToastItem) => void>;
  }
)[toastListenersKey] ??= new Set<(item: ToastItem) => void>());

function emitToast(kind: ToastKind, message: string) {
  const item = { id: ++nextToastId, kind, message } satisfies ToastItem;
  toastListeners.forEach((listener) => listener(item));
}

export const Toast = {
  success: (message: string) => emitToast('success', message),
  error: (message: string) => emitToast('error', message),
  warning: (message: string) => emitToast('warning', message),
  info: (message: string) => emitToast('info', message),
};

export function ToastViewport() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const onToast = (item: ToastItem) => {
      setItems((current) => [...current, item]);
      window.setTimeout(
        () => setItems((current) => current.filter(({ id }) => id !== item.id)),
        4200
      );
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[1200] flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'pointer-events-auto rounded-lg border bg-card px-3 py-2 text-sm shadow-lg',
            item.kind === 'error' && 'border-destructive/40 text-destructive',
            item.kind === 'warning' && 'border-orange-500/40 text-orange-700 dark:text-orange-300',
            item.kind === 'success' &&
              'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
          )}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}

type ModalProps = {
  title?: React.ReactNode;
  visible: boolean;
  onCancel: () => void;
  onOk?: () => void | Promise<void>;
  okText?: string;
  cancelText?: string;
  footer?: React.ReactNode | null;
  children?: React.ReactNode;
  width?: number | string;
  className?: string;
};

export function Modal({
  title,
  visible,
  onCancel,
  onOk,
  okText = 'OK',
  cancelText = 'Cancel',
  footer,
  children,
  width,
  className,
  style,
}: ModalProps & { closeOnEsc?: boolean; style?: React.CSSProperties }) {
  return (
    <BaseDialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        showCloseButton
        className={cn('sm:max-w-none', className)}
        style={{ ...(width ? { maxWidth: width } : {}), ...style }}
      >
        {title && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="max-h-[70vh] overflow-auto">{children}</div>
        {footer !== null &&
          (footer ?? (
            <DialogFooter>
              <Button theme="borderless" onClick={onCancel}>
                {cancelText}
              </Button>
              {onOk && <Button onClick={() => void onOk()}>{okText}</Button>}
            </DialogFooter>
          ))}
      </DialogContent>
    </BaseDialog>
  );
}

export function Popconfirm({
  title,
  content,
  onConfirm,
  children,
}: {
  title: React.ReactNode;
  content?: React.ReactNode;
  onConfirm: () => void | Promise<void>;
  children: React.ReactElement;
  position?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      (children.props as { onClick?: (event: React.MouseEvent) => void }).onClick?.(event);
      setOpen(true);
    },
  });
  return (
    <>
      {trigger}
      <BaseDialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {content && <DialogDescription>{content}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button theme="borderless" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="danger"
              onClick={() => {
                setOpen(false);
                void onConfirm();
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </BaseDialog>
    </>
  );
}

export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
}) {
  return React.cloneElement(children, { title: typeof content === 'string' ? content : undefined });
}

export function Space({
  children,
  className,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} style={style}>
      {children}
    </div>
  );
}

type Column<T> = {
  title?: React.ReactNode;
  dataIndex?: keyof T | string;
  key?: string;
  width?: number | string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
};

export function Table<T extends object>({
  columns,
  dataSource,
  loading,
  rowKey = 'id' as keyof T,
  pagination,
  onRow,
}: {
  columns: Column<T>[];
  dataSource: T[];
  loading?: boolean;
  rowKey?: keyof T | ((row: T) => string);
  pagination?:
    | {
        currentPage?: number;
        pageSize?: number;
        total?: number;
        onPageChange?: (page: number) => void;
        onPageSizeChange?: (size: number) => void;
        showSizeChanger?: boolean;
        pageSizeOpts?: number[];
      }
    | false;
  size?: 'small' | 'default';
  onRow?: (row: T) => React.HTMLAttributes<HTMLTableRowElement>;
}) {
  const paginationConfig = pagination === false ? undefined : pagination;
  const page = paginationConfig?.currentPage ?? 1;
  const pageSize = paginationConfig?.pageSize ?? dataSource.length;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key ?? String(column.dataIndex) ?? index}
                className="px-3 py-2 font-medium"
                style={{ width: column.width }}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center">
                <Spin />
              </td>
            </tr>
          ) : dataSource.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                No records
              </td>
            </tr>
          ) : (
            dataSource.map((row, rowIndex) => {
              const props = onRow?.(row) ?? {};
              const key =
                typeof rowKey === 'function' ? rowKey(row) : String(row[rowKey as keyof T]);
              return (
                <tr
                  key={key}
                  {...props}
                  className={cn('border-t border-border/70 hover:bg-muted/30', props.className)}
                >
                  {columns.map((column, columnIndex) => {
                    const value = column.dataIndex
                      ? (row as Record<string, unknown>)[String(column.dataIndex)]
                      : undefined;
                    return (
                      <td
                        key={column.key ?? String(column.dataIndex) ?? columnIndex}
                        className="px-3 py-2 align-middle"
                        style={{ width: column.width }}
                      >
                        {column.render ? column.render(value, row, rowIndex) : String(value ?? '')}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {paginationConfig && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button
            size="small"
            theme="light"
            disabled={page <= 1}
            onClick={() => paginationConfig.onPageChange?.(page - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            size="small"
            theme="light"
            disabled={dataSource.length < pageSize}
            onClick={() => paginationConfig.onPageChange?.(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export function List({
  dataSource,
  renderItem,
  className,
}: {
  dataSource: unknown[];
  renderItem: (item: any, index: number) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-border', className)}>
      {dataSource.map((item, index) => renderItem(item, index))}
    </div>
  );
}
List.Item = function ListItem({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center px-3 py-2', className)} {...props}>
      {children}
    </div>
  );
};

export function Card({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { shadows?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card', className)} {...props}>
      {children}
    </div>
  );
}

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size'> & {
  onChange?: (value: string) => void;
  size?: 'small' | 'default';
  placeholder?: string;
  showClear?: boolean;
};
export function Select({
  onChange,
  size,
  placeholder,
  children,
  className,
  ...props
}: SelectProps) {
  return (
    <select
      {...props}
      className={cn(
        'h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
        size === 'small' && 'h-7 text-xs',
        className
      )}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {placeholder && !props.value && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {children}
    </select>
  );
}
Select.Option = function Option({
  value,
  children,
}: {
  value: string;
  children?: React.ReactNode;
}) {
  return <option value={value}>{children}</option>;
};

export function TextArea({
  onChange,
  autosize,
  rows,
  className,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  onChange?: InputChange;
  autosize?: { minRows?: number; maxRows?: number };
}) {
  return (
    <textarea
      {...props}
      rows={rows ?? autosize?.minRows}
      className={cn(
        'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        className
      )}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

export function InputNumber({
  value,
  onChange,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value?: number | null;
  onChange?: (value: number | null) => void;
}) {
  return (
    <input
      {...props}
      type="number"
      value={value ?? ''}
      className={cn(
        'h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        props.className
      )}
      onChange={(event) =>
        onChange?.(event.target.value === '' ? null : Number(event.target.value))
      }
    />
  );
}

export function Switch({
  checked,
  onChange,
  className,
}: {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn(
        'relative h-5 w-9 rounded-full bg-muted transition-colors aria-checked:bg-primary',
        className
      )}
      onClick={() => onChange?.(!checked)}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

const CheckboxGroupContext = React.createContext<{
  value: string[];
  onChange: (value: string[]) => void;
} | null>(null);
export function CheckboxGroup({
  value,
  onChange,
  children,
  direction,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  children?: React.ReactNode;
  direction?: 'vertical' | 'horizontal';
}) {
  return (
    <CheckboxGroupContext.Provider value={{ value, onChange }}>
      <div className={cn('flex gap-2', direction === 'vertical' ? 'flex-col' : 'flex-row')}>
        {children}
      </div>
    </CheckboxGroupContext.Provider>
  );
}
export function Checkbox({
  value,
  children,
  checked,
  onChange,
}: {
  value?: string;
  children?: React.ReactNode;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const group = React.useContext(CheckboxGroupContext);
  const isChecked = group && value ? group.value.includes(value) : checked;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={!!isChecked}
        onChange={(event) => {
          if (group && value)
            group.onChange(
              event.target.checked
                ? [...group.value, value]
                : group.value.filter((item) => item !== value)
            );
          onChange?.(event.target.checked);
        }}
      />
      {children}
    </label>
  );
}

const RadioGroupContext = React.createContext<{
  value: string;
  onChange: (value: string) => void;
} | null>(null);
export function RadioGroup({
  value,
  onChange,
  children,
  style,
}: {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children?: React.ReactNode;
  type?: string;
  style?: React.CSSProperties;
}) {
  return (
    <RadioGroupContext.Provider
      value={{ value, onChange: (next) => onChange({ target: { value: next } }) }}
    >
      <div className="flex flex-wrap gap-2" style={style}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}
export function Radio({ value, children }: { value: string; children?: React.ReactNode }) {
  const group = React.useContext(RadioGroupContext);
  return (
    <label
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm',
        group?.value === value && 'border-primary bg-primary/10 text-primary'
      )}
    >
      <input
        type="radio"
        checked={group?.value === value}
        onChange={() => group?.onChange(value)}
      />
      {children}
    </label>
  );
}

export { Check };
