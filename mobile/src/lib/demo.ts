/**
 * Demo helpers (sample mobile money messages and the like) are for development
 * and for a deliberately built demo APK. A normal release build has none, so
 * sample data can never be mistaken for a real payment.
 *
 * Turn them on for a build by setting the repository variable MOBILE_DEMO_TOOLS
 * to 1 (the pipeline passes it as EXPO_PUBLIC_DEMO_TOOLS).
 */
const developing = typeof __DEV__ !== 'undefined' && __DEV__;

export const DEMO_TOOLS: boolean = developing || process.env.EXPO_PUBLIC_DEMO_TOOLS === '1';
