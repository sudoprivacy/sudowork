# Markdown Mermaid Preview Design

## Background

Workspace Markdown preview currently renders fenced Mermaid blocks as syntax-highlighted code instead of diagrams.

Example:

````markdown
```mermaid
graph TD
  A --> B
```
````

The preview path is:

- Workspace file click reads `.md` files as UTF-8 text and opens `contentType: 'markdown'`.
- `MarkdownViewer.tsx` renders Markdown with `Streamdown`.
- `MarkdownViewer.tsx` overrides `components.code`.
- The custom code renderer only special-cases `latex`, `math`, and `tex`; all other languages, including `mermaid`, go through `SyntaxHighlighter`.

Although `Streamdown` has Mermaid support, the local `components.code` override prevents its default Mermaid renderer from taking over.

## Goals

- Render fenced `mermaid` code blocks as Mermaid diagrams in workspace Markdown preview.
- Keep existing behavior for ordinary code blocks.
- Preserve the existing KaTeX behavior for `latex`, `math`, and `tex` blocks.
- Keep rendering failures isolated to the affected diagram.
- Avoid broad changes to the Markdown preview pipeline.

## Non-Goals

- Replacing `Streamdown` or rewriting Markdown parsing.
- Changing assistant message Markdown rendering.
- Adding Mermaid support to non-Markdown file viewers.
- Supporting every Graphviz/DOT syntax variant in this change.

## Recommended Approach

Add a narrow Mermaid branch in the `MarkdownViewer.tsx` `code` renderer:

```tsx
if (language === 'mermaid') {
  return <MermaidDiagram code={codeContent} theme={currentTheme} />;
}
```

Create a dedicated renderer component:

```text
src/renderer/pages/conversation/preview/components/renderers/MermaidDiagram.tsx
```

This keeps the change localized and avoids regressions in existing code block rendering.

## Component Design

`MermaidDiagram` should:

- Dynamically import `mermaid` with `import('mermaid')`.
- Render asynchronously with loading, success, and error states.
- Generate a stable, unique render id for each diagram.
- Re-render when `code` or theme changes.
- Use Mermaid `securityLevel: 'strict'`.
- Insert only Mermaid-generated SVG into the DOM.
- Wrap the SVG in an overflow container so large topology diagrams do not break Markdown layout.

Suggested state shape:

```ts
type MermaidRenderState =
  | { status: 'loading' }
  | { status: 'success'; svg: string }
  | { status: 'error'; message: string };
```

## Styling

Use a constrained wrapper:

```css
.mermaid-diagram {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--color-border-1);
  border-radius: 8px;
  background: var(--color-bg-1);
  padding: 16px;
}

.mermaid-diagram svg {
  display: block;
  max-width: none;
  height: auto;
}
```

Prefer horizontal scrolling over aggressive scaling. Business topology diagrams are often wide; shrinking them to fit can make text unreadable.

## Theme Handling

Pass the current app theme from `MarkdownViewer.tsx` into `MermaidDiagram`.

Recommended Mermaid config:

- `theme: 'base'`
- `securityLevel: 'strict'`
- light/dark `themeVariables` based on current Sudowork semantic colors where practical

The first iteration can use conservative defaults and refine colors later.

## Error Handling

If Mermaid parsing or rendering fails:

- Show a compact error panel.
- Include the error message.
- Show the original Mermaid source in a code block or collapsible details section.
- Do not throw from the component.

This prevents one invalid diagram from blanking the whole Markdown preview.

## Dependency Strategy

Add `mermaid` as a direct dependency in `package.json`.

Rationale:

- The project should not rely on `streamdown`'s transitive dependency.
- Direct dependency makes versioning and security updates explicit.
- Dynamic import limits initial Markdown preview cost.

## Testing Plan

Add focused coverage for:

- Mermaid fenced blocks render through `MermaidDiagram`, not `SyntaxHighlighter`.
- Regular fenced code blocks still render through the existing highlighter.
- `latex`, `math`, and `tex` blocks still use KaTeX.
- Mermaid render errors show fallback UI instead of crashing.

If component testing Mermaid itself is heavy, mock `import('mermaid')` and assert render state transitions.

## Alternative Considered

Remove the custom `components.code` override and let `Streamdown` handle Mermaid by default.

This is not recommended because it would change all code block behavior, including existing syntax highlighting and KaTeX handling. A targeted `language === 'mermaid'` branch has a smaller blast radius.

## Implementation Steps

1. Add `mermaid` as a direct dependency.
2. Create `MermaidDiagram.tsx`.
3. Add the `language === 'mermaid'` branch in `MarkdownViewer.tsx`.
4. Add scoped styling for the Mermaid wrapper.
5. Add focused tests or regression coverage.
6. Run `bun run lint:fix` and `bunx tsc --noEmit`.
