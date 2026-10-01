import { is_ios } from '../../fullscreen';
import { Button, Dialog, FullscreenHelp, Paragraph, gp } from '../pixel/components';

function install_steps(): string[] {
    if (/SamsungBrowser/i.test(navigator.userAgent)) {
        return [
            '1. Tap the install icon in the address bar of Samsung Internet.',
            '2. Confirm Install, then launch the game from your apps.',
            'If the icon is missing, try Menu > Add page to > Home screen or Apps screen.',
        ];
    }
    if (/Android/i.test(navigator.userAgent)) {
        return [
            '1. Open the browser menu.',
            '2. Choose Add to Home screen or Install app, then confirm Install.',
            '3. Launch the new game icon.',
        ];
    }
    return [
        'Use the install icon in the address bar or the install option in your browser menu.',
        'If neither is available, open this site in Chrome or Edge. In Safari on Mac, use File > Add to Dock.',
    ];
}

export function InstallDialog({
    available,
    pending,
    onInstall,
    onClose,
}: {
    available: boolean;
    pending: boolean;
    onInstall: () => void;
    onClose: () => void;
}) {
    if (is_ios()) return <FullscreenHelp issue="unavailable" onClose={onClose} />;
    return (
        <Dialog title="INSTALL GAME" width={300} onClose={onClose}>
            <div className="gp-col" style={{ gap: gp(5) }}>
                <Paragraph
                    text="You can install from the browser menu even after dismissing an earlier offer."
                    width={280}
                />
                {install_steps().map((text) => (
                    <Paragraph key={text} text={text} width={280} />
                ))}
                <Paragraph
                    text={
                        window.isSecureContext
                            ? 'Already installed? Open the game from its app icon.'
                            : 'App installation needs HTTPS. Open the secure address of this site first.'
                    }
                    width={280}
                    color="dim"
                />
                <div className="gp-row justify-end">
                    {available && <Button label="INSTALL" primary disabled={pending} onClick={onInstall} />}
                    <Button label="GOT IT" onClick={onClose} />
                </div>
            </div>
        </Dialog>
    );
}
