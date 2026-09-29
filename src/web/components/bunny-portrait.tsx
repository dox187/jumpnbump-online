import { useEffect, useState } from 'preact/hooks';
import { preread_datafile, read_gob, read_pcx } from '../../data';

let portraits: Promise<string[]> | null = null;

/** Renders the standing frame of each bunny from the original level's sprite sheet. */
function load_portraits(): Promise<string[]> {
    if (!portraits) {
        portraits = fetch('/levels/jumpbump.dat')
            .then((response) => response.arrayBuffer())
            .then((dat) => {
                preread_datafile(dat);
                const palette = new Uint8ClampedArray(768);
                read_pcx('level.pcx', palette);
                const rabbit = read_gob('rabbit.gob');
                return [0, 1, 2, 3].map((bunny) => {
                    const image = bunny * 18;
                    const width = rabbit.width[image];
                    const height = rabbit.height[image];
                    const pixels = rabbit.data[image];
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext('2d')!;
                    const rgba = context.createImageData(width, height);
                    for (let i = 0; i < pixels.length; i++) {
                        const color = pixels[i];
                        rgba.data[i * 4] = palette[color * 3] << 2;
                        rgba.data[i * 4 + 1] = palette[color * 3 + 1] << 2;
                        rgba.data[i * 4 + 2] = palette[color * 3 + 2] << 2;
                        rgba.data[i * 4 + 3] = color === 0 ? 0 : 255;
                    }
                    context.putImageData(rgba, 0, 0);
                    return canvas.toDataURL();
                });
            })
            .catch(() => {
                portraits = null;
                return [];
            });
    }
    return portraits;
}

export function BunnyPortrait({ bunny, className = '' }: { bunny: number; className?: string }) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        load_portraits().then((images) => active && setSrc(images[bunny] ?? null));
        return () => {
            active = false;
        };
    }, [bunny]);

    return (
        <div className={`flex items-center justify-center ${className}`}>
            {src && <img src={src} alt="" className="w-12 h-12 object-contain [image-rendering:pixelated]" />}
        </div>
    );
}
