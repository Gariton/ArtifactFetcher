'use client';

import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Carbon design system — Claude Design (ArtifactFetcher UI 刷新) より。
 * ダークをデフォルトに、深い neutral 基調 + 成果物アクセント。
 * アクセントは「一貫した L/C、hue のみ変化」の方針に従い oklch で生成する。
 */
function accentScale(baseL: number, c: number, h: number): MantineColorsTuple {
    const ok = (l: number, cc: number) => `oklch(${l.toFixed(3)} ${cc.toFixed(3)} ${h})`;
    return [
        ok(0.96, c * 0.30),
        ok(0.92, c * 0.50),
        ok(0.86, c * 0.70),
        ok(0.80, c * 0.85),
        ok(0.74, c * 0.95),
        ok(0.70, c),
        ok(baseL, c),                 // 6 — base (filled)
        ok(Math.max(baseL - 0.08, 0.2), c),
        ok(Math.max(baseL - 0.16, 0.16), c),
        ok(Math.max(baseL - 0.24, 0.12), c),
    ] as unknown as MantineColorsTuple;
}

// 成果物アクセント（oklch）
const docker = accentScale(0.66, 0.16, 250);
const npm = accentScale(0.62, 0.20, 25);
const pip = accentScale(0.64, 0.18, 300);
const rpm = accentScale(0.82, 0.14, 90);
const hf = accentScale(0.72, 0.13, 188);
const gitlab = accentScale(0.68, 0.18, 45);

// ステータス
const success = accentScale(0.74, 0.15, 150);
const warning = accentScale(0.80, 0.14, 80);

// Carbon neutrals（ダーク面）— dark[7]=body, dark[6]=surface, dark[0]=text
const dark: MantineColorsTuple = [
    '#F2F4F8', // 0 text
    '#C0C6D0', // 1 strong muted
    '#9AA1AE', // 2 muted (dimmed)
    '#6B7280', // 3 dimmer / meta
    '#3A3D44', // 4 strong border
    '#24272F', // 5 border / hover
    '#14161B', // 6 surface
    '#0A0B0E', // 7 body bg
    '#070809', // 8
    '#050507', // 9
];

// 温かみのある light neutrals
const gray: MantineColorsTuple = [
    '#FBFAF8', // 0 bg
    '#F2F0EC', // 1 raised
    '#E8E6E2', // 2 border
    '#D8D5CF', // 3
    '#BAB6AE', // 4
    '#9C9890', // 5
    '#6A6E78', // 6 muted
    '#4A4D55', // 7
    '#2E3036', // 8
    '#1B1C20', // 9 text
];

export const theme = createTheme({
    primaryColor: 'docker',
    primaryShade: 6,
    autoContrast: true,
    luminanceThreshold: 0.45,

    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontFamilyMonospace: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",

    defaultRadius: 'md',
    radius: {
        xs: '6px',
        sm: '9px',
        md: '14px',
        lg: '18px',
        xl: '24px',
    },

    white: '#FFFFFF',
    black: '#0A0B0E',

    colors: {
        dark,
        gray,
        docker,
        npm,
        pip,
        rpm,
        hf,
        gitlab,
        success,
        warning,
    },

    headings: {
        fontWeight: '600',
        sizes: {
            h1: { fontSize: '2rem', lineHeight: '1.15', fontWeight: '600' },
            h2: { fontSize: '1.5rem', lineHeight: '1.2', fontWeight: '600' },
            h3: { fontSize: '1.25rem', lineHeight: '1.25', fontWeight: '600' },
        },
    },

    components: {
        Card: {
            defaultProps: {
                radius: 'lg',
                withBorder: true,
            },
        },
        Button: {
            defaultProps: {
                radius: 'md',
            },
        },
        TextInput: {
            defaultProps: { radius: 'md' },
        },
        PasswordInput: {
            defaultProps: { radius: 'md' },
        },
        Modal: {
            defaultProps: { radius: 'lg' },
        },
        Tabs: {
            defaultProps: { radius: 'xl' },
        },
        Tooltip: {
            defaultProps: { radius: 'sm', withArrow: true },
        },
        Badge: {
            defaultProps: { radius: 'sm' },
        },
    },
});
