/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FieldError, FieldState, FieldWarning } from '@flowgram.ai/free-layout-editor';

interface StatePanelProps {
  errors?: FieldState['errors'];
  warnings?: FieldState['warnings'];
  invalid?: boolean;
}

export const Feedback = ({ errors, warnings, invalid }: StatePanelProps) => {
  const renderFeedbacks = (fs: FieldError[] | FieldWarning[] | undefined) => {
    if (!fs) return null;
    return fs.map((f) => <span key={f.name}>{f.message}</span>);
  };
  return (
    <div className="text-xs">
      {errors?.length ? <div className="text-destructive">{renderFeedbacks(errors)}</div> : null}
      {warnings?.length ? <div className="text-amber-600">{renderFeedbacks(warnings)}</div> : null}
    </div>
  );
};
