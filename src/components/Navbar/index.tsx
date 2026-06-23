'use client';
import { Box, Divider, Stack, Text } from "@mantine/core";
import { IconLayoutList } from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { AccentTile } from "../AccentTile";
import { MANAGERS } from "../managers";
import classes from "./styles.module.css";

export const AppNavbar = () => {
    const pathname = usePathname();
    return (
        <Stack p="sm" gap={4}>
            {MANAGERS.map((m) => {
                const active = pathname?.startsWith(m.href);
                return (
                    <Box
                        key={m.id}
                        component="a"
                        href={m.href}
                        className={classes.link}
                        data-active={active || undefined}
                        style={active ? {
                            background: `color-mix(in oklch, var(--af-${m.color}) 14%, transparent)`,
                        } : undefined}
                    >
                        <AccentTile color={m.color} code={m.code} size="md" />
                        <Text
                            fz={14}
                            fw={active ? 600 : 400}
                            style={{ color: active ? `var(--af-${m.color})` : "var(--af-text)" }}
                        >
                            {m.label}
                        </Text>
                    </Box>
                );
            })}
            <Divider my="xs" color="var(--af-border)" />
            <Box
                component="a"
                href="/admin"
                className={classes.link}
                data-active={pathname?.startsWith("/admin") || undefined}
            >
                <span className={classes.adminIcon}>
                    <IconLayoutList size={18} stroke={1.6} />
                </span>
                <Text fz={14} c="var(--af-muted)">管理 / ログ</Text>
            </Box>
        </Stack>
    );
}
