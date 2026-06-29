'use client';

import { Box, Group, Modal, ModalProps, Stack, Text } from "@mantine/core";
import {
    IconAlertTriangle,
    IconCheck,
    IconCircleCheck,
    IconClock,
    IconLoader2,
    IconMinus,
} from "@tabler/icons-react";
import { ReactNode } from "react";
import { AccentTile } from "../AccentTile";
import { type ManagerId } from "../managers";
import classes from "./styles.module.css";

export type ProgressItemStatus = "waiting" | "running" | "done" | "skipped" | "error";

export type ProgressItem = {
    key: string;
    /** mono label — sha / filename */
    label: string;
    status: ProgressItemStatus;
    percent?: number;
    /** right-aligned meta (size / state) */
    meta?: string;
    error?: string;
};

export type ProgressStat = {
    value: ReactNode;
    unit?: string;
    label: string;
    accent?: boolean;
};

function StatusIcon({ status, accent }: { status: ProgressItemStatus; accent: string }) {
    switch (status) {
        case "done":
            return <IconCheck size={16} stroke={2.4} color="var(--af-success)" />;
        case "running":
            return <IconLoader2 size={16} stroke={2.2} color={accent} className={classes.spin} />;
        case "skipped":
            return <IconMinus size={15} stroke={2} color="var(--af-skipped)" />;
        case "error":
            return <IconAlertTriangle size={16} stroke={2.2} color="var(--af-error)" />;
        default:
            return <IconClock size={15} stroke={1.8} color="var(--af-dim)" />;
    }
}

function ItemRow({ item, accent }: { item: ProgressItem; accent: string }) {
    const isError = item.status === "error";
    if (isError) {
        return (
            <Box className={classes.errorRow}>
                <Group gap={11} wrap="nowrap" align="center">
                    <StatusIcon status="error" accent={accent} />
                    <Text className="af-mono" fz={11.5} flex={1} style={{ color: "#E6C0C0", wordBreak: "break-all" }}>
                        {item.label}
                    </Text>
                    {item.meta && (
                        <Text className="af-mono" fz={11} c="var(--af-error)" style={{ flex: "none" }}>
                            {item.meta}
                        </Text>
                    )}
                </Group>
                {item.error && (
                    <Text className="af-mono" fz={11} mt={8} pl={27} style={{ color: "var(--af-error)", opacity: 0.85 }}>
                        {item.error}
                    </Text>
                )}
            </Box>
        );
    }
    const barColor =
        item.status === "done" ? "color-mix(in oklch, var(--af-success) 60%, transparent)" :
        item.status === "running" ? accent : "transparent";
    const pct = item.status === "done" ? 100 : item.percent ?? 0;
    return (
        <Group gap={11} wrap="nowrap" align="center" className={item.status === "waiting" ? classes.waiting : undefined}>
            <span style={{ flex: "none", display: "inline-flex" }}>
                <StatusIcon status={item.status} accent={accent} />
            </span>
            <Text
                className="af-mono"
                fz={11.5}
                style={{
                    flex: "none",
                    width: 92,
                    color: item.status === "running" ? "var(--af-text)" : "var(--af-muted)",
                    textDecoration: item.status === "done" ? "line-through" : undefined,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                {item.label}
            </Text>
            <div className={classes.track}>
                <div
                    className={classes.fill}
                    style={{
                        width: `${pct}%`,
                        background: barColor,
                        boxShadow: item.status === "running" ? `0 0 8px color-mix(in oklch, ${accent} 60%, transparent)` : undefined,
                    }}
                />
            </div>
            <Text className="af-mono" fz={10.5} style={{ flex: "none", width: 52, textAlign: "right", color: "var(--af-dim)" }}>
                {item.meta ?? ""}
            </Text>
        </Group>
    );
}

export type ProgressModalProps = {
    accent: ManagerId;
    title: string;
    subtitle: string;
    /** 0-100, or undefined for indeterminate */
    overallPercent?: number;
    state: "running" | "done" | "error";
    stats?: ProgressStat[];
    items: ProgressItem[];
    /** optional banner under the header (done/partial) */
    banner?: ReactNode;
    /** optional extra panel (e.g. live logs) rendered above the item list */
    extra?: ReactNode;
    footer: ReactNode;
} & Omit<ModalProps, "title" | "children">;

export function ProgressModal({
    accent,
    title,
    subtitle,
    overallPercent,
    state,
    stats,
    items,
    banner,
    extra,
    footer,
    ...props
}: ProgressModalProps) {
    const accentVar = `var(--af-${accent})`;
    const code = accent.toUpperCase().slice(0, 3);
    const pctColor = state === "error" ? "var(--af-error)" : state === "done" ? "var(--af-success)" : accentVar;

    return (
        <Modal
            {...props}
            centered
            radius="lg"
            size="lg"
            withCloseButton={false}
            padding={0}
            transitionProps={{ transition: "pop" }}
            classNames={{ content: classes.modalContent }}
        >
            {/* header */}
            <Group className={classes.header} gap={13} wrap="nowrap">
                <AccentTile color={accent} code={code} size="lg" />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fz={15} fw={600}>{title}</Text>
                    <Text className="af-mono" fz={11} c="var(--af-dim)" mt={2} truncate>{subtitle}</Text>
                </div>
            </Group>

            {banner}

            {/* overall dashboard */}
            <Box className={classes.section}>
                <Group justify="space-between" align="baseline" mb={12}>
                    <Text fz={13} c="var(--af-muted)">全体の進捗</Text>
                    <Text className="af-mono" fz={22} fw={600} style={{ color: pctColor }}>
                        {overallPercent ?? 0}%
                    </Text>
                </Group>
                <div className={classes.overallTrack}>
                    <div
                        className={classes.overallFill}
                        style={{
                            width: `${overallPercent ?? 0}%`,
                            background: `linear-gradient(90deg, color-mix(in oklch, ${pctColor} 80%, black), ${pctColor})`,
                            boxShadow: `0 0 12px color-mix(in oklch, ${pctColor} 50%, transparent)`,
                        }}
                    />
                </div>
                {stats && stats.length > 0 && (
                    <Group gap={10} mt={18} grow>
                        {stats.map((s, i) => (
                            <Box key={i} className={classes.statCard}>
                                <Text className="af-mono" fz={18} fw={600} style={{ color: s.accent ? "var(--af-success)" : undefined }}>
                                    {s.value}
                                    {s.unit && <Text span className="af-mono" fz={11} c="var(--af-dim)">{s.unit}</Text>}
                                </Text>
                                <Text fz={11} c="var(--af-dim)" mt={3}>{s.label}</Text>
                            </Box>
                        ))}
                    </Group>
                )}
            </Box>

            {extra && <Box className={classes.extra}>{extra}</Box>}

            {/* item list */}
            <Box className={classes.list}>
                {items.length === 0 ? (
                    <Group justify="center" py="xl">
                        <IconLoader2 size={22} className={classes.spin} color={accentVar} />
                    </Group>
                ) : (
                    <Stack gap={11}>
                        {items.map((it) => (
                            <ItemRow key={it.key} item={it} accent={accentVar} />
                        ))}
                    </Stack>
                )}
            </Box>

            {/* footer */}
            <Group className={classes.footer} justify="space-between" wrap="nowrap">
                {footer}
            </Group>
        </Modal>
    );
}

/** Success / partial-failure banner used in the done/error states */
export function ProgressBanner({
    tone,
    title,
    detail,
}: {
    tone: "success" | "error";
    title: string;
    detail: string;
}) {
    const color = tone === "success" ? "var(--af-success)" : "var(--af-error)";
    const Icon = tone === "success" ? IconCircleCheck : IconAlertTriangle;
    return (
        <Box
            className={classes.banner}
            style={{
                background: `color-mix(in oklch, ${color} 9%, transparent)`,
                border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
            }}
        >
            <span
                className={classes.bannerIcon}
                style={{ background: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
            >
                <Icon size={22} stroke={2.2} />
            </span>
            <div>
                <Text fz={14.5} fw={600} style={{ color }}>{title}</Text>
                <Text className="af-mono" fz={11.5} c="var(--af-muted)" mt={3}>{detail}</Text>
            </div>
        </Box>
    );
}
