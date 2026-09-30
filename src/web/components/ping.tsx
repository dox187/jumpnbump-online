import { useLayoutEffect, useRef } from 'preact/hooks';
import { gp } from '../pixel/components';

/** A small native-pixel font keeps the indicator quiet without scaling pixels differently from the game. */
const GLYPHS: Record<string, string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    m: ['000', '000', '111', '111', '101'],
    s: ['000', '011', '110', '001', '110'],
    '-': ['000', '000', '111', '000', '000'],
};

export function Ping({ value }: { value: number | null }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const text = `${value ?? '--'} ms`;
    const color = value !== null && value > 300 ? '#ff6048' : value !== null && value > 150 ? '#ffd648' : '#ffffff';
    const label = value === null ? 'Ping unavailable' : `Ping: ${value} ms`;
    const width = text.length * 4 - 1;
    useLayoutEffect(() => {
        const context = canvas.current!.getContext('2d')!;
        context.clearRect(0, 0, width, 5);
        context.fillStyle = color;
        [...text].forEach((character, i) => {
            GLYPHS[character]?.forEach((row, y) => {
                [...row].forEach((pixel, x) => {
                    if (pixel === '1') context.fillRect(i * 4 + x, y, 1, 1);
                });
            });
        });
    }, [text, color]);
    return (
        <span className="gp-ping" aria-label={label} title={label} data-ping={value ?? 'unavailable'}>
            <canvas
                ref={canvas}
                width={width}
                height={5}
                aria-hidden="true"
                style={{ width: gp(width), height: gp(5) }}
            />
        </span>
    );
}
