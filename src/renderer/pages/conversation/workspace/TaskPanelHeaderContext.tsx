import React, { createContext, useContext, useState, useRef } from 'react';

interface TaskPanelHeaderCtx {
  dagCount: number;
  setDagCount: (n: number) => void;
  openFullscreenRef: React.MutableRefObject<(() => void) | null>;
}

const TaskPanelHeaderCtx = createContext<TaskPanelHeaderCtx>({
  dagCount: 0,
  setDagCount: () => {},
  openFullscreenRef: { current: null },
});

export const TaskPanelHeaderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dagCount, setDagCount] = useState(0);
  const openFullscreenRef = useRef<(() => void) | null>(null);
  return <TaskPanelHeaderCtx.Provider value={{ dagCount, setDagCount, openFullscreenRef }}>{children}</TaskPanelHeaderCtx.Provider>;
};

export const useTaskPanelHeader = () => useContext(TaskPanelHeaderCtx);
