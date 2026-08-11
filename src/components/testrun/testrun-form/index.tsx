/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC } from 'react';

import classNames from 'classnames';

import { DisplaySchemaTag } from '@/form-semantics';
import { Input } from '@/components/ui/input';

import { JsonValueEditor } from '../json-value-editor';
import { useFormMeta } from '../hooks/use-form-meta';
import { useFields } from '../hooks/use-fields';
import { useSyncDefault } from '../hooks';

import styles from './index.module.less';

interface TestRunFormProps {
  values: Record<string, unknown>;
  setValues: (values: Record<string, unknown>) => void;
}

export const TestRunForm: FC<TestRunFormProps> = ({ values, setValues }) => {
  const formMeta = useFormMeta();

  const fields = useFields({
    formMeta,
    values,
    setValues,
  });

  useSyncDefault({
    formMeta,
    values,
    setValues,
  });

  const renderField = (field: any) => {
    switch (field.type) {
      case 'boolean':
        return (
          <div className={styles.fieldInput}>
            <input
              aria-label={`${field.name} value`}
              className="h-4 w-4 accent-primary"
              type="checkbox"
              checked={Boolean(field.value)}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          </div>
        );
      case 'integer':
        return (
          <div className={styles.fieldInput}>
            <Input
              type="number"
              step="1"
              value={field.value ?? ''}
              onChange={(event) =>
                field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
              placeholder="Please input integer"
            />
          </div>
        );
      case 'number':
        return (
          <div className={styles.fieldInput}>
            <Input
              type="number"
              step="any"
              value={field.value ?? ''}
              onChange={(event) =>
                field.onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
              placeholder="Please input number"
            />
          </div>
        );
      case 'object':
        return (
          <div className={classNames(styles.fieldInput, styles.codeEditorWrapper)}>
            <JsonValueEditor value={field.value} onChange={(value) => field.onChange(value)} />
          </div>
        );
      case 'array':
        return (
          <div className={classNames(styles.fieldInput, styles.codeEditorWrapper)}>
            <JsonValueEditor value={field.value} onChange={(value) => field.onChange(value)} />
          </div>
        );
      default:
        return (
          <div className={styles.fieldInput}>
            <Input
              value={field.value ?? ''}
              onChange={(event) => field.onChange(event.target.value)}
              placeholder="Please input text"
            />
          </div>
        );
    }
  };

  // Show empty state if no fields
  if (fields.length === 0) {
    return (
      <div className={styles.formContainer}>
        <div className={styles.emptyState}>
          <div className={styles.emptyText}>Empty</div>
          <div className={styles.emptyText}>No inputs found in start node</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.formContainer}>
      {fields.map((field) => (
        <div key={field.name} className={styles.fieldGroup}>
          <label htmlFor={field.name} className={styles.fieldLabel}>
            {field.name}
            {field.required && <span className={styles.requiredIndicator}>*</span>}
            <span className={styles.fieldTypeIndicator}>
              <DisplaySchemaTag
                value={{
                  type: field.type,
                  items: field.itemsType
                    ? {
                        type: field.itemsType,
                      }
                    : undefined,
                }}
              />
            </span>
          </label>
          {renderField(field)}
        </div>
      ))}
    </div>
  );
};
