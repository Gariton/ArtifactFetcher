import { type ManagerId } from "../managers";

const SIZE_MAP = {
    sm: { box: 24, radius: 6, font: 9, glow: 10 },
    md: { box: 30, radius: 8, font: 11, glow: 16 },
    lg: { box: 46, radius: 12, font: 13, glow: 20 },
    xl: { box: 54, radius: 14, font: 16, glow: 26 },
} as const;

/**
 * Glowing accent tile with a short code (DKR / NPM / …).
 * The signature visual element of the Carbon design.
 */
export function AccentTile({
    color,
    code,
    size = "md",
    glow = true,
}: {
    color: ManagerId | "docker";
    code: string;
    size?: keyof typeof SIZE_MAP;
    glow?: boolean;
}) {
    const s = SIZE_MAP[size];
    const accent = `var(--af-${color})`;
    return (
        <span
            style={{
                width: s.box,
                height: s.box,
                borderRadius: s.radius,
                background: accent,
                boxShadow: glow ? `0 0 ${s.glow}px color-mix(in oklch, ${accent} 45%, transparent)` : undefined,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--mantine-font-family-monospace)",
                fontWeight: 600,
                fontSize: s.font,
                color: "#070A10",
                flex: "none",
                letterSpacing: "0.02em",
            }}
        >
            {code}
        </span>
    );
}
