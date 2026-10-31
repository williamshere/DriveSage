## 2024-11-20 - Memoizing rapidly-updating UI components during background tasks
**Learning:** During scans, the App state updates frequently (every 260ms). Without `React.memo` and `useMemo`, this causes the entire UI tree, including complex elements like `DriveCard` and extensive dataset processing loops, to re-render constantly and cause UI jank.
**Action:** Use `React.memo` for components rendering complex SVGs (like `DriveCard`) and `useMemo` for derived datasets in frequently updating components.
