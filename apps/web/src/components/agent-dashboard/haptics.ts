// web haptic API 封裝
export const haptic = {
    impact: (style: 'light' | 'medium' | 'heavy' | 'soft') => {
        if (typeof window === 'undefined' || !window.navigator?.vibrate) return;
        switch (style) {
            case 'light': window.navigator.vibrate(10); break;
            case 'medium': window.navigator.vibrate(20); break;
            case 'heavy': window.navigator.vibrate(40); break;
            case 'soft': window.navigator.vibrate(5); break;
        }
    },
    notification: (type: 'success' | 'warning' | 'error') => {
        if (typeof window === 'undefined' || !window.navigator?.vibrate) return;
        switch (type) {
            case 'success': window.navigator.vibrate([10, 50, 10]); break; // tap-tap
            case 'warning': window.navigator.vibrate([30, 40, 30, 40, 30]); break; // tap-tap-tap
            case 'error': window.navigator.vibrate([50, 50, 50, 50, 50]); break; // long pulses
        }
    }
};
