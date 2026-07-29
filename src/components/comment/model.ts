/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Emitter } from '@flowgram.ai/free-layout-editor';

import { CommentEditorEventParams } from './type';
import { CommentEditorDefaultValue, CommentEditorEvent } from './constant';

export class CommentEditorModel {
  private innerValue: string = CommentEditorDefaultValue;

  private emitter: Emitter<CommentEditorEventParams> = new Emitter();

  private editor: HTMLTextAreaElement;

  /** Register event listener */
  public on = this.emitter.event;

  /** Get current value */
  public get value(): string {
    return this.innerValue;
  }

  /** Set model value from outside */
  public setValue(value: string = CommentEditorDefaultValue): void {
    if (!this.initialized) {
      return;
    }
    if (value === this.innerValue) {
      return;
    }
    this.innerValue = value;
    this.syncEditorValue();
    this.emitter.fire({
      type: CommentEditorEvent.Change,
      value: this.innerValue,
    });
  }

  /** Set initial model value from outside */
  public setInitValue(value: string = CommentEditorDefaultValue): void {
    if (!this.initialized) {
      return;
    }
    if (value === this.innerValue) {
      return;
    }
    this.innerValue = value;
    this.syncEditorValue();
    this.emitter.fire({
      type: CommentEditorEvent.Init,
      value: this.innerValue,
    });
  }

  public set element(el: HTMLTextAreaElement) {
    if (this.initialized) {
      return;
    }
    this.editor = el;
  }

  /** Get the editor DOM node */
  public get element(): HTMLTextAreaElement {
    return this.editor;
  }

  /** Focus/blur the editor */
  public setFocus(focused: boolean): void {
    if (!this.initialized) {
      return;
    }
    if (focused && !this.focused) {
      this.editor.focus();
    } else if (!focused && this.focused) {
      this.editor.blur();
      this.deselect();
      this.emitter.fire({
        type: CommentEditorEvent.Blur,
      });
    }
  }

  /** Select the end of the text */
  public selectEnd(): void {
    if (!this.initialized) {
      return;
    }
    // Get the text length
    const length = this.editor.value.length;
    // Set the selection range to the end of the text (start and end are both the text length)
    this.editor.setSelectionRange(length, length);
  }

  /** Get focus state */
  public get focused(): boolean {
    return document.activeElement === this.editor;
  }

  /** Deselect text */
  private deselect(): void {
    const selection: Selection | null = window.getSelection();

    // Clear all selection ranges
    if (selection) {
      selection.removeAllRanges();
    }
  }

  /** Whether initialized */
  private get initialized(): boolean {
    return Boolean(this.editor);
  }

  /**
   * Sync the editor instance content
   * > **NOTICE:** *To avoid performance impact, only call when an external value change leaves the
   *   editor value out of sync with the model value.*
   */
  private syncEditorValue(): void {
    if (!this.initialized) {
      return;
    }
    this.editor.value = this.innerValue;
  }
}
