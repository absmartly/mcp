export const DEBUG = false;

// Debug logging helper
export function debug(...args: any[]) {
    if (DEBUG) {
        console.log(...args);
    }
}