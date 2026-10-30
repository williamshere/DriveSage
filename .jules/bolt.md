
## 2024-10-30 - Memoizing Dashboard UI lists and maps during rapid state changes
**Learning:** Rapid state changes in `App.jsx` (such as scan progress bars running every 260ms) can cause significant lag if child components like the Dashboard trigger expensive re-renders and recalculations (like `histories.find` in mapping functions).
**Action:** When a parent element updates frequently with state changes, use `useMemo` on heavy layout segments inside child components, optimize $O(N*M)$ lookups in `.map` loops to $O(N)$ HashMaps, and ensure functions passed down are wrapped in `useCallback` to avoid breaking memoization.
