export const DEBUG = false;

export function debug(...args: any[]) {
    if (DEBUG) {
        console.log(...args);
    }
}