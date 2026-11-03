## 2026-11-01 - Optimizing React Dashboard Reactivity
**Learning:** During rapid state updates (like scan progress ticks every 260ms), having heavy operations directly in the render phase of the dashboard (e.g. array reductions, sortings, map reductions via computeHealth/checkAlerts) leads to substantial UI stutter and CPU overhead, especially if the components re-render inline arrow functions on every tick.
**Action:** Use `React.memo` for list components and pass stable function references from the parent (calling specific element logic inside the child). Wrap heavy mapping/reducing lists in `useMemo` so they only recalculate when their specific dependencies (like `drives` or `histories`) change, not on unrelated parent state updates.

## 2026-11-03 - Memoizing DriveCards lookup
**Learning:** During rapid scan ticks, React processes every state change by executing `.map()` containing an $O(N^2)$ `.find()` to pair `histories` with `drives`. Without memoization, this recalculates on every progress tick causing heavy CPU usage and UI stutter.
**Action:** Use `useMemo` for inline list renderings to avoid constant reallocation and repeated O(N^2) matching lookups, especially when list dependencies haven't changed.
