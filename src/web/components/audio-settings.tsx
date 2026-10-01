import { useEffect } from 'preact/hooks';
import { AudioPreview, dj_dispose_preview, dj_preview_audio, dj_stop_preview } from '../../sdl/sound';
import { OnlineSettings } from '../hooks/online-settings';
import { Checkbox, Text, gp } from '../pixel/components';

function VolumeControl({
    kind,
    label,
    muted,
    value,
    onMute,
    onVolume,
}: {
    kind: AudioPreview;
    label: string;
    muted: boolean;
    value: number;
    onMute: (value: boolean) => void;
    onVolume: (value: number) => void;
}) {
    const preview = () => dj_preview_audio(kind);
    const change = (value: number) => {
        onVolume(Math.max(0, Math.min(100, value)));
        preview();
    };
    return (
        <div className="gp-row gp-volume-row">
            <div style={{ width: gp(96), flexShrink: 0 }}>
                <Checkbox
                    label={`Mute ${kind === 'music' ? 'music' : 'FX'}`}
                    ariaLabel={`Mute ${kind === 'music' ? 'music' : 'sound effects'}`}
                    checked={muted}
                    onChange={onMute}
                />
            </div>
            <input
                className="gp-volume-slider"
                type="range"
                min="0"
                max="100"
                step="1"
                value={value}
                disabled={muted}
                aria-label={`${label} volume`}
                aria-valuetext={`${value}%`}
                onFocus={preview}
                onPointerDown={preview}
                onBlur={dj_stop_preview}
                onInput={(event) => change(Number(event.currentTarget.value))}
                onKeyDown={(event) => {
                    const delta = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0;
                    if (delta || event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        event.stopPropagation();
                        change(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : value + delta);
                    }
                    // Up/Down belong to menu navigation, including synthetic gamepad key events.
                }}
            />
            <span className="gp-volume-value">
                <Text text={`${value}%`} color={muted ? 'dim' : 'white'} />
            </span>
        </div>
    );
}

export function AudioSettings({
    settings,
    updateSettings,
}: {
    settings: OnlineSettings;
    updateSettings: (patch: Partial<OnlineSettings>) => void;
}) {
    useEffect(() => () => dj_dispose_preview(), []);
    return (
        <>
            <VolumeControl
                kind="music"
                label="Music"
                muted={settings.muteMusic}
                value={settings.musicVolume}
                onMute={(muteMusic) => updateSettings({ muteMusic })}
                onVolume={(musicVolume) => updateSettings({ musicVolume })}
            />
            <VolumeControl
                kind="effects"
                label="Effects"
                muted={settings.muteEffects}
                value={settings.effectsVolume}
                onMute={(muteEffects) => updateSettings({ muteEffects })}
                onVolume={(effectsVolume) => updateSettings({ effectsVolume })}
            />
        </>
    );
}
