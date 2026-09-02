/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import React, { useCallback, useMemo, useRef } from 'react';
import { useThemeContext } from '@/renderer/context/ThemeContext';
import { useCodeMirrorScroll, useScrollSyncTarget } from '../../hooks/useScrollSyncHelpers';

interface TextEditorProps {
  value: string; // 编辑器内容 / Editor content
  onChange: (value: string) => void; // 内容变化回调 / Content change callback
  readOnly?: boolean; // 是否只读 / Whether read-only
  containerRef?: React.RefObject<HTMLDivElement>; // 容器引用，用于滚动同步 / Container ref for scroll sync
  onScroll?: (scrollTop: number, scrollHeight: number, clientHeight: number) => void; // 滚动回调 / Scroll callback
}

/**
 * 通用文本编辑器组件
 * Generic text editor component
 *
 * 基于 CodeMirror 实现，支持语法高亮和实时编辑
 * Based on CodeMirror, supports syntax highlighting and live editing
 */
const TextEditor: React.FC<TextEditorProps> = ({ value, onChange, readOnly = false, containerRef, onScroll }) => {
  const { theme } = useThemeContext();
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  // 使用 CodeMirror 滚动 Hook / Use CodeMirror scroll hook
  const { setScrollPercent } = useCodeMirrorScroll(editorWrapperRef, onScroll);

  // 监听外部滚动同步请求 / Listen for external scroll sync requests
  const handleTargetScroll = useCallback(
    (targetPercent: number) => {
      setScrollPercent(targetPercent);
    },
    [setScrollPercent]
  );
  useScrollSyncTarget(containerRef, handleTargetScroll);

  // 使用 useCallback 包装 onChange，避免每次渲染都创建新函数 / Use useCallback to avoid creating new function on each render
  const handleChange = useCallback(
    (val: string) => {
      onChange(val);
    },
    [onChange]
  );

  // 缓存 basicSetup 配置，避免每次渲染都创建新对象 / Memoize basicSetup config
  const basicSetupConfig = useMemo(
    () => ({
      lineNumbers: true, // 显示行号 / Show line numbers
      highlightActiveLineGutter: true, // 高亮当前行号 / Highlight active line gutter
      highlightActiveLine: true, // 高亮当前行 / Highlight active line
      foldGutter: true, // 折叠功能 / Code folding
    }),
    []
  );

  // 缓存样式对象 / Memoize style object
  const editorStyle = useMemo(
    () => ({
      fontSize: '14px',
      height: '100%',
      textAlign: 'left' as const, // 文本左对齐 / Text align left
    }),
    []
  );

  return (
    <div ref={containerRef} className='h-full w-full overflow-hidden text-left'>
      <div ref={editorWrapperRef} className='h-full w-full'>
        <CodeMirror value={value} height='100%' theme={theme === 'dark' ? 'dark' : 'light'} extensions={[EditorView.lineWrapping]} onChange={handleChange} readOnly={readOnly} basicSetup={basicSetupConfig} style={editorStyle} />
      </div>
    </div>
  );
};

// 使用 React.memo 优化，只在 props 真正改变时才重新渲染 / Use React.memo to only re-render when props actually change
export default React.memo(TextEditor);
