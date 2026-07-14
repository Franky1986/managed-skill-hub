import { useEffect } from 'react';

export const BACKGROUND_POLL_INTERVAL_MS = 10_000;

export function useBackgroundPolling(
    task: (signal: AbortSignal) => Promise<void>,
    enabled = true,
    intervalMs = BACKGROUND_POLL_INTERVAL_MS
): void {
    useEffect(() => {
        if (!enabled) {
            return;
        }

        let active = true;
        let inFlight = false;
        let controller: AbortController | null = null;

        const run = async () => {
            if (!active || inFlight) {
                return;
            }
            inFlight = true;
            controller = new AbortController();
            try {
                await task(controller.signal);
            } catch {
                // Background refresh failures are handled by each page without clearing visible data.
            } finally {
                inFlight = false;
                controller = null;
            }
        };

        void run();
        const timer = window.setInterval(() => void run(), intervalMs);

        return () => {
            active = false;
            window.clearInterval(timer);
            controller?.abort();
        };
    }, [enabled, intervalMs, task]);
}
