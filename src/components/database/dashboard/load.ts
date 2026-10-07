/**
 * The dashboard's lazy chunk: the layout, the page scope (`DashboardProvider`)
 * its tab bar shares with it, and the widget chrome. `DatabaseViews` renders
 * from it, and a dashboard page (`DatabaseView`) starts it while its document
 * loads, so the page seldom waits for the code once the document is in. One
 * loader, so every caller shares one request and one chunk.
 */
export const loadDashboard = () => import('./index');
