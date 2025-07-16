// Global debug flag - set to true to enable debug logging
export const DEBUG = false;

// Debug logging helper
export function debug(...args: any[]) {
    if (DEBUG) {
        console.log(...args);
    }
}