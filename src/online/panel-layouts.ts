/** Name positions in the custom artwork, relative to each 48x64 score panel's top left corner. */
export type PanelNameLayout = {
    x: number;
    y: number;
    width: number;
    /** Inclusive erase rectangle; use its dominant colour unless a clean source column/row is supplied. */
    erase?: readonly [left: number, top: number, right: number, bottom: number, source_x?: number, source_y?: number][];
};

const ORIGINAL: PanelNameLayout = { x: 7, y: 23, width: 35 };
const ORIGINAL_SLOTS = [ORIGINAL, ORIGINAL, ORIGINAL, ORIGINAL];
const layouts = new Map<string, readonly PanelNameLayout[]>();

function add(files: string, layout: PanelNameLayout | readonly PanelNameLayout[]) {
    const slots = Array.isArray(layout) ? layout : [layout, layout, layout, layout];
    for (const file of files.split(' ')) layouts.set(`${file}.dat`, slots);
}

const wide: PanelNameLayout = { ...ORIGINAL, erase: [[1, 24, 46, 31]] };
add('0gravity erehwon home pyramid2 partrsea', wide);
add('2vs2 bludbank mario2 snowland soutpark', { ...ORIGINAL, erase: [[5, 22, 39, 31]] });
add('acidb', { ...ORIGINAL, erase: [[6, 23, 42, 30]] });
add('2vs2r2', { ...ORIGINAL, erase: [[6, 23, 43, 31, 44]] });
add('arabian haunted mountnbj', { ...ORIGINAL, erase: [[5, 22, 39, 31]] });
add('bubble bubble100', { x: 6, y: 4, width: 35, erase: [[5, 3, 16, 13, 37]] });
add('carmgdon just ma nicenicy riverdnc space totalcs', { ...ORIGINAL, erase: [] });

// These portraits sit beside the old text, rather than above it. Leave room for their ears and faces.
add('castle deathbowl funhouse multi tunnels', {
    x: 6,
    y: 23,
    width: 22,
    erase: [[6, 22, 27, 31, 4]],
});
add('fccastles', { x: 1, y: 23, width: 29, erase: [[1, 23, 30, 30, 0]] });
add('em5 em6 em7 thelab', { x: 7, y: 24, width: 35, erase: [[12, 24, 33, 31]] });
add('icecube', { x: 7, y: 25, width: 35, erase: [[9, 27, 36, 33, 37]] });
add('inthepc', { ...ORIGINAL, erase: [[7, 18, 36, 32, 45, 20]] });
add('mariodm1', { x: 6, y: 4, width: 36, erase: [[1, 3, 44, 14, 46]] });
add('mslug1 mslug2 mslug3 mslug4 mslug5 mslug6', {
    x: 5,
    y: 9,
    width: 39,
    erase: [[2, 6, 45, 16, 46, 20]],
});
add('munchers', { ...ORIGINAL, erase: [[6, 23, 35, 31]] });
add('nuclear', { ...ORIGINAL, erase: [[5, 23, 24, 30, 25]] });
add('pinball', { ...ORIGINAL, erase: [[7, 23, 34, 30, 36]] });
add('prektor1', { ...ORIGINAL, erase: [[3, 24, 44, 31]] });
add('skullcave', { ...ORIGINAL, erase: [[5, 22, 46, 31]] });
add('prektor2', [ORIGINAL, ORIGINAL, wide, { ...ORIGINAL, erase: [[8, 24, 41, 31]] }]);
add('prektor3', [{ ...ORIGINAL, erase: [[5, 24, 40, 31]] }, ORIGINAL, ORIGINAL, ORIGINAL]);
add('prektor4', { ...ORIGINAL, erase: [[5, 24, 25, 31, 4]] });
add('prektor5', { x: 11, y: 9, width: 28, erase: [[11, 10, 29, 14, 31, 10]] });
add('samatary', { ...ORIGINAL, erase: [[2, 23, 43, 31]] });
add('smb1 smb2 smb3', { x: 6, y: 24, width: 36, erase: [[5, 23, 44, 32, 8, 22]] });
const sonic: PanelNameLayout = {
    x: 1,
    y: 0,
    width: 44,
    erase: [[0, 0, 47, 10, 47, 12]],
};
add('sonic01 sonic02 sonic03 sonic04 sonic05 sonic06', [
    sonic,
    sonic,
    sonic,
    { ...sonic, erase: [[0, 0, 47, 15, 47, 12]] },
]);
add('stone', [
    { ...ORIGINAL, erase: [[6, 20, 24, 31, 5]] },
    {
        ...ORIGINAL,
        erase: [
            [5, 23, 25, 31],
            [25, 26, 44, 32],
        ],
    },
    { ...ORIGINAL, erase: [[4, 26, 30, 32]] },
    { ...ORIGINAL, erase: [[1, 22, 36, 31]] },
]);
add('terra', { ...ORIGINAL, erase: [[13, 25, 36, 30, 37]] });
add('void', { ...ORIGINAL, erase: [[6, 26, 22, 32, 5]] });

export function panel_name_layouts(level: string): readonly PanelNameLayout[] {
    return layouts.get(level) ?? ORIGINAL_SLOTS;
}
