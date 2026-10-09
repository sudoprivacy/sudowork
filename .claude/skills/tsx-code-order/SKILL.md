---
name: tsx-code-order
description: |
  规范 TSX/React 函数组件内部的代码书写顺序。
  Use when: 用户说「整理组件顺序」「代码顺序乱了」「按规范排列 hooks」「tsx 代码排序」「梳理一下组件结构」，
  或在写新组件 / review 已有组件时需要对齐代码顺序规范。
---

# TSX Code Order

规范化 React 函数组件内部代码块的书写顺序，提升可读性与一致性。

**开始时声明：** "我在用 tsx-code-order skill 整理组件代码顺序。"

## 标准顺序

函数组件内部，按以下顺序从上到下排列：

```
1. 组件内部常量（不依赖 props/state 的固定值）
2. useState
3. useRef
4. useContext / 其他返回单一值的内置 Hook
5. 自定义 Hook（use*）
6. 普通派生变量（从 props / state 直接计算，不需要缓存）
7. useMemo（需要缓存的派生值）
8. useEffect / useLayoutEffect
9. useCallback（需要缓存的函数引用）
10. 事件处理函数 / 普通函数（on* 命名）
11. JSX return
```

文件底部（组件函数体外）：

```
12. 辅助组件（不导出的内部小组件）
13. Props interface（I<ComponentName>Props，必须放在文件最底部）
```

## 各区块说明

### 1. 组件内部常量

不依赖运行时 props / state 的固定值，写在 Hook 之前：

```tsx
const MAX_RETRIES = 3;
const OPTIONS = ['a', 'b', 'c'];
```

### 2. useState

所有状态声明集中在一起：

```tsx
const [isOpen, setIsOpen] = useState(false);
const [name, setName] = useState('');
```

### 3. useRef

```tsx
const inputRef = useRef<HTMLInputElement>(null);
const timerRef = useRef<ReturnType<typeof setTimeout>>();
```

### 4. useContext / 其他简单 Hook

```tsx
const { theme } = useContext(ThemeContext);
const { t } = useTranslation();
const navigate = useNavigate();
```

### 5. 自定义 Hook（use*）

调用自定义 hook，拿到数据或状态：

```tsx
const { data, isLoading } = useFetchUsers();
const { isVisible, onToggle } = useToggle();
```

### 6. 普通派生变量

不需要 useMemo 的简单派生值，直接 `const`：

```tsx
const isDisabled = isLoading || !name;
const displayName = name.trim() || 'Anonymous';
```

判断标准：计算量小、依赖稳定、不产生新引用的就用普通 `const`；反之用 `useMemo`。

### 7. useMemo

缓存计算量较大或需要稳定引用的派生值：

```tsx
const sortedList = useMemo(() => [...items].sort(compareByName), [items]);
const chartData = useMemo(() => transformToChartFormat(rawData), [rawData]);
```

### 8. useEffect / useLayoutEffect

副作用统一放在函数之前。多个 effect 按逻辑相关性排列（初始化 → 监听 → 清理）：

```tsx
useEffect(() => {
  fetchData();
}, []);

useEffect(() => {
  document.title = name;
}, [name]);
```

### 9. useCallback

缓存需要传递给子组件或放入依赖数组的函数：

```tsx
const onSubmit = useCallback(() => {
  // ...
}, [name]);
```

### 10. 事件处理函数 / 普通函数

本项目统一用 `on*` 命名，不用 `handle*`：

```tsx
function onConfirm() {
  setIsOpen(false);
  onOk(name);
}

function onInputChange(value: string) {
  setName(value);
}
```

### 11. JSX return

```tsx
return (
  <Modal visible={isOpen} onOk={onConfirm}>
    <Input value={name} onChange={onInputChange} />
  </Modal>
);
```

## 文件级结构（组件体外）

```
[导入语句]

[模块级常量，如 const DEFAULT_PAGE_SIZE = 20]

export default function MyComponent({ ... }: IMyComponentProps) {
  // 组件内部代码按上面顺序排列
}

function InternalHelper() { ... }   // 内部辅助组件（不导出）

interface IMyComponentProps {        // Props interface 永远放最底部
  isOpen: boolean;
  onOk: () => void;
}
```

## 执行时的工作流

1. **读文件** — 完整读取目标 TSX 文件
2. **识别各区块** — 对照顺序表，标注每段代码属于哪一类
3. **检查乱序** — 找出不符合顺序的区块，列出需要移动的内容
4. **重排** — 按标准顺序重写组件体，不改变任何逻辑
5. **校验** — 运行 `bunx eslint <path> --fix` 和 `bunx tsc --noEmit` 确保无错误

> 只调整顺序，不改业务逻辑、不重构代码、不拆分文件。如有发现命名不符合规范（bool 非 `is*`、handler 非 `on*`），单独列出告知用户，不自动修改命名。
