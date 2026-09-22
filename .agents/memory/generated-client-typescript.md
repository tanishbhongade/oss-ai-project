---
name: Generated client TypeScript
description: TypeScript library settings needed by the generated browser API client
---

Composite TypeScript projects that compile the generated React API client need both `dom` and `dom.iterable` in their `lib` list. The generated fetch helper uses `Headers.entries()`, which is only declared when the iterable DOM types are included.

**Why:** The first OpenAPI codegen pass succeeded but the chained library typecheck failed because the workspace base config only included `es2022`, and the client package overrode its lib list without `dom.iterable`.

**How to apply:** If generated client typechecking reports missing iterable DOM methods, update the affected composite tsconfig rather than editing generated output.