# 命名规范 / Naming Conventions

## 事件处理 / Event handlers

事件相关命名以 `on` 开头。
Event-related names start with `on`.

- prop：`onClick`、`onChange`、`onSubmit`、`onSelect`
- 自定义事件回调 prop 同样以 `on` 开头：`onConfirm`、`onClose`、`onValueChange`

```tsx
// ✅
<Button onClick={handleSave} />;
interface Props {
  onConfirm: () => void;
  onValueChange: (v: string) => void;
}

// ❌
<Button click={handleSave} />;
interface Props {
  confirm: () => void;
}
```

## 布尔值 / Booleans

布尔值（变量、state、prop）以 `is` 开头。
Boolean values (variables, state, props) start with `is`.

- `isLoading`、`isOpen`、`isDisabled`、`isVisible`、`isActive`

```tsx
// ✅
const [isOpen, setIsOpen] = useState(false);
const isDisabled = !value || isLoading;
interface Props {
  isActive: boolean;
}

// ❌
const [open, setOpen] = useState(false);
const disabled = !value || loading;
```
