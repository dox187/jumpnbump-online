// Changed by dox187 on 2026-09-30 from jumpnbump.js (https://github.com/jamsinclair/jumpnbump.js).

import { useEffect } from 'preact/hooks';

import { useState } from 'preact/hooks';

const getConnectedGamepads = () => {
    // Some browsers (Firefox) only offer gamepads to secure (HTTPS) pages
    if (!navigator.getGamepads) return [];
    return navigator.getGamepads().filter(Boolean) as Gamepad[];
};

export function useGamepads() {
    const [gamepads, setGamepads] = useState<Gamepad[]>(() =>
        typeof window !== 'undefined' ? getConnectedGamepads() : []
    );

    useEffect(() => {
        const handleGamepadConnected = () => {
            setGamepads(getConnectedGamepads());
        };

        const handleGamepadDisconnected = () => {
            setGamepads(getConnectedGamepads());
        };

        window.addEventListener('gamepadconnected', handleGamepadConnected);
        window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

        return () => {
            window.removeEventListener('gamepadconnected', handleGamepadConnected);
            window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
        };
    }, []);

    return gamepads;
}
