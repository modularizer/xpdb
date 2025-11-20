export enum PlatformName {
    WEB = 'web',
    MOBILE = 'mobile',
    NODE = 'node'
}

export interface PlatformCompatibility<T = boolean> {
    [PlatformName.WEB]: T;
    [PlatformName.MOBILE]: T;
    [PlatformName.NODE]: T;
}

/**
 * Detect the current platform
 */
export function detectPlatform(): PlatformName {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
        return PlatformName.WEB;
    }

    // Check if we're in React Native
    try {
        const reactNative = require('react-native');
        const { Platform } = reactNative;
        if (Platform && Platform.OS) {
            return Platform.OS === 'web' ? PlatformName.WEB : PlatformName.MOBILE;
        }
    } catch {
        // react-native not available
    }

    // Default to node for server-side
    return PlatformName.NODE;
}