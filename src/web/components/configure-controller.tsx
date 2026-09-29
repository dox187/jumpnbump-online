import { useState, useEffect } from 'preact/hooks';
import { Button, Dialog, Paragraph, Text } from '../pixel/components';

type ConfigPhase = 'left' | 'right' | 'jump' | 'confirm';

type ConfigureControllerProps = {
    gamepad: Gamepad;
    onComplete: (mappings: string[]) => void;
    onCancel: () => void;
};

export function ConfigureController({ gamepad, onComplete, onCancel }: ConfigureControllerProps) {
    const [phase, setPhase] = useState<ConfigPhase>('left');
    const [mappings, setMappings] = useState<string[]>(['', '', '']);
    const [listening, setListening] = useState(true);
    const [detectedButton, setDetectedButton] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(false);

    // Snapshot axis resting values on mount so we only detect deliberate movement
    const [axisBaseline] = useState<number[]>(() => {
        const gp = navigator.getGamepads()[gamepad.index];
        return gp ? Array.from(gp.axes) : [];
    });

    const phaseLabels: Record<ConfigPhase, string> = {
        left: 'Move Left',
        right: 'Move Right',
        jump: 'Jump',
        confirm: 'Check the buttons',
    };

    const phaseDescriptions: Record<ConfigPhase, string> = {
        left: 'Press the button you want to use to move left',
        right: 'Press the button you want to use to move right',
        jump: 'Press the button you want to use to jump',
        confirm: 'Save these buttons for this gamepad?',
    };

    const phaseIndex = ['left', 'right', 'jump', 'confirm'].indexOf(phase);

    // Listen for gamepad button presses
    useEffect(() => {
        if (!listening || phase === 'confirm' || cooldown) return;

        let frameId: number;
        let lastPressedButton: string | null = null;

        const checkButtons = () => {
            const freshGamepad = navigator.getGamepads()[gamepad.index];
            if (!freshGamepad) return;

            // Check for button presses
            for (let i = 0; i < freshGamepad.buttons.length; i++) {
                if (freshGamepad.buttons[i].pressed && freshGamepad.buttons[i].value > 0.5) {
                    const buttonId = `button_${i}`;

                    // Prevent duplicate detection of the same press
                    if (buttonId !== lastPressedButton) {
                        // Skip if this button is already assigned to another action
                        if (mappings.includes(buttonId)) {
                            lastPressedButton = buttonId;
                            continue;
                        }

                        lastPressedButton = buttonId;
                        setDetectedButton(buttonId);
                        setListening(false);
                        setCooldown(true);

                        const newMappings = [...mappings];
                        if (phase === 'left') newMappings[0] = buttonId;
                        if (phase === 'right') newMappings[1] = buttonId;
                        if (phase === 'jump') newMappings[2] = buttonId;

                        setMappings(newMappings);

                        // Move to next phase after a short delay
                        setTimeout(() => {
                            if (phase === 'left') setPhase('right');
                            else if (phase === 'right') setPhase('jump');
                            else if (phase === 'jump') setPhase('confirm');

                            setDetectedButton(null);
                            setListening(true);

                            // Add a cooldown to prevent accidental inputs
                            setTimeout(() => {
                                setCooldown(false);
                            }, 500);
                        }, 1000);

                        return;
                    }
                } else if (lastPressedButton === `button_${i}`) {
                    // Button was released
                    lastPressedButton = null;
                }
            }

            // Check for axis movement (for analog sticks)
            for (let i = 0; i < freshGamepad.axes.length; i++) {
                const value = freshGamepad.axes[i];
                const baseline = axisBaseline[i] ?? 0;
                // Detect movement relative to resting position to handle axes that don't rest at 0
                if (Math.abs(value - baseline) > 0.5) {
                    const axisId = `axis_${i}_${value > baseline ? 'pos' : 'neg'}_${baseline.toFixed(2)}`;

                    // Skip if this axis is already assigned to another action
                    if (mappings.includes(axisId)) {
                        lastPressedButton = axisId;
                        continue;
                    }

                    // Prevent duplicate detection
                    if (axisId !== lastPressedButton) {
                        lastPressedButton = axisId;
                        setDetectedButton(axisId);
                        setListening(false);
                        setCooldown(true);

                        const newMappings = [...mappings];
                        if (phase === 'left') newMappings[0] = axisId;
                        if (phase === 'right') newMappings[1] = axisId;
                        if (phase === 'jump') newMappings[2] = axisId;

                        setMappings(newMappings);

                        // Move to next phase after a short delay
                        setTimeout(() => {
                            if (phase === 'left') setPhase('right');
                            else if (phase === 'right') setPhase('jump');
                            else if (phase === 'jump') setPhase('confirm');

                            setDetectedButton(null);
                            setListening(true);

                            // Add a cooldown to prevent accidental inputs
                            setTimeout(() => {
                                setCooldown(false);
                            }, 500);
                        }, 1000);

                        return;
                    }
                } else if (lastPressedButton && lastPressedButton.startsWith(`axis_${i}`)) {
                    // Axis returned to neutral position
                    lastPressedButton = null;
                }
            }

            frameId = requestAnimationFrame(checkButtons);
        };

        frameId = requestAnimationFrame(checkButtons);

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [gamepad, phase, listening, mappings, cooldown]);

    const handleConfirm = () => {
        onComplete(mappings);
    };

    const handleReset = () => {
        setMappings(['', '', '']);
        setPhase('left');
    };

    const getFriendlyButtonName = (mapping: string) => {
        if (!mapping) return 'Not set';

        if (mapping.startsWith('button_')) {
            const buttonIndex = parseInt(mapping.replace('button_', ''), 10);
            return `Button ${buttonIndex}`;
        }

        if (mapping.startsWith('axis_')) {
            const [_, axisIndex, direction] = mapping.split('_');
            return `Axis ${axisIndex} ${direction === 'pos' ? '(Positive)' : '(Negative)'}`;
        }

        return mapping;
    };

    const duplicate = mappings.some((m, i) => mappings.indexOf(m) !== i && m !== '');

    return (
        <Dialog title="SET UP GAMEPAD" onClose={onCancel} width={230}>
            <div className="gp-col">
                <div className="gp-row justify-between">
                    <Text text={phaseLabels[phase]} color="gold" />
                    {phase !== 'confirm' && <Text text={`${phaseIndex + 1}/3`} color="dim" />}
                </div>
                <Paragraph text={phaseDescriptions[phase]} width={214} />
                {phase === 'confirm' ? (
                    <div className="gp-col" style={{ gap: 0 }}>
                        <Text text={`Move left: ${getFriendlyButtonName(mappings[0])}`} />
                        <Text text={`Move right: ${getFriendlyButtonName(mappings[1])}`} />
                        <Text text={`Jump: ${getFriendlyButtonName(mappings[2])}`} />
                        {duplicate && (
                            <Paragraph
                                text="The same input is used for more than one action."
                                width={214}
                                color="red"
                            />
                        )}
                    </div>
                ) : (
                    <Text
                        text={
                            listening
                                ? 'Waiting for input...'
                                : `Detected: ${getFriendlyButtonName(detectedButton || '')}`
                        }
                        color={listening ? 'dim' : 'green'}
                    />
                )}
                <div className="gp-row justify-end">
                    <Button label="CANCEL" onClick={onCancel} />
                    {phase === 'confirm' ? (
                        <>
                            <Button label="RESET" onClick={handleReset} />
                            <Button label="SAVE" primary onClick={handleConfirm} />
                        </>
                    ) : (
                        <Button
                            label="SKIP"
                            onClick={() => {
                                if (phase === 'left') setPhase('right');
                                else if (phase === 'right') setPhase('jump');
                                else if (phase === 'jump') setPhase('confirm');
                            }}
                        />
                    )}
                </div>
            </div>
        </Dialog>
    );
}
