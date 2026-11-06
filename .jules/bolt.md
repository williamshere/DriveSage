## 2026-11-01 - Optimizing React Dashboard Reactivity
**Learning:** During rapid state updates (like scan progress ticks every 260ms), having heavy operations directly in the render phase of the dashboard (e.g. array reductions, sortings, map reductions via computeHealth/checkAlerts) leads to substantial UI stutter and CPU overhead, especially if the components re-render inline arrow functions on every tick.
**Action:** Use `React.memo` for list components and pass stable function references from the parent (calling specific element logic inside the child). Wrap heavy mapping/reducing lists in `useMemo` so they only recalculate when their specific dependencies (like `drives` or `histories`) change, not on unrelated parent state updates.

## 2026-11-03 - Memoizing DriveCards lookup
**Learning:** During rapid scan ticks, React processes every state change by executing `.map()` containing an $O(N^2)$ `.find()` to pair `histories` with `drives`. Without memoization, this recalculates on every progress tick causing heavy CPU usage and UI stutter.
**Action:** Use `useMemo` for inline list renderings to avoid constant reallocation and repeated O(N^2) matching lookups, especially when list dependencies haven't changed.

## 2024-11-04 - React Memoization and Hook Placement
**Learning:** Frequent state updates (like scan progress updates every 260ms) trigger rapid re-renders. If expensive array operations (like `.sort()`, `.reduce()`, or `.map()` over large datasets) are done inline, they will severely degrade performance. Additionally, when wrapping these inline operations in `useMemo`, it is absolutely critical to place the hook declarations *before* any early return statements, otherwise React will throw a "Rules of Hooks" error at runtime.
**Action:** Always memoize list mappings and sorting in components that receive fast-updating props (like `progress`). Verify that `useMemo` is placed at the top level of the component, before any conditional renders or early returns.

## 2026-11-04 - Stabilizing Recharts Data Arrays
**Learning:** During rapid scan ticks, providing inline array derivations to complex children like Recharts components (`<LineChart>`, `<AreaChart>`) triggers full re-renders and heavy layout thrashing, even if the actual chart data hasn't changed.
**Action:** Always wrap data array transformations for Recharts components in `useMemo` hooks, providing them with referentially stable arrays. When moving inline logic to hooks, remember to place the hooks before any early returns and safely handle optional variables (e.g., `drive?.temperature`).
