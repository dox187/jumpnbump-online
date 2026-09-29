import { useEffect, useState } from 'preact/hooks';
import { net, NetState } from '../../net/client';

/** Re-renders whenever the multiplayer connection state changes. */
export function useNet(): NetState {
    const [state, setState] = useState(net.state);
    useEffect(() => {
        setState(net.state);
        return net.subscribe(() => setState(net.state));
    }, []);
    return state;
}
