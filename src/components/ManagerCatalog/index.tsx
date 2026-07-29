'use client';

import { Box, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconChevronRight, IconLayoutList } from '@tabler/icons-react';
import { AccentTile } from '../AccentTile';
import { MANAGERS, type Manager } from '../managers';
import classes from './styles.module.css';

function ManagerCard({ m }: { m: Manager }) {
    return (
        <Box
            component="a"
            href={m.href}
            className={classes.card}
            style={{
                ['--accent' as string]: `var(--af-${m.color})`,
            }}
        >
            <Group justify="space-between" align="flex-start">
                <AccentTile color={m.color} code={m.code} size="lg" />
                <span className={classes.chevron} style={{ color: `var(--af-${m.color})` }}>
                    <IconChevronRight size={20} stroke={1.7} />
                </span>
            </Group>
            <Stack gap={7} mt="md">
                <Text fz={18} fw={600} style={{ letterSpacing: '-0.01em' }}>
                    {m.label}
                </Text>
                <Text fz={13.5} c="var(--af-muted)" lh={1.6}>
                    {m.blurb}
                </Text>
            </Stack>
            <Group gap={7} mt="auto" pt="md">
                {m.tags.map((t) => (
                    <span
                        key={t}
                        className={`${classes.tag} af-mono`}
                        style={{
                            color: `var(--af-${m.color})`,
                            background: `color-mix(in oklch, var(--af-${m.color}) 12%, transparent)`,
                        }}
                    >
                        {t}
                    </span>
                ))}
            </Group>
        </Box>
    );
}

export function ManagerCatalog() {
    return (
        <Stack gap="md">
            <Text className="af-eyebrow">{MANAGERS.length} つの成果物マネージャ</Text>
            <SimpleGrid
                cols={{ base: 1, xs: 2, md: 3 }}
                spacing="lg"
            >
                {MANAGERS.map((m) => (
                    <ManagerCard key={m.id} m={m} />
                ))}

                <Box component="a" href="/admin" className={classes.adminCard}>
                    <Group gap="md" align="center" h="100%">
                        <span className={classes.adminIcon}>
                            <IconLayoutList size={22} stroke={1.6} />
                        </span>
                        <div>
                            <Text fz={14} fw={600} c="var(--af-text)">管理 / ログ</Text>
                            <Text fz={12} c="var(--af-dim)" mt={3}>リクエスト履歴の確認</Text>
                        </div>
                    </Group>
                </Box>
            </SimpleGrid>
        </Stack>
    );
}
