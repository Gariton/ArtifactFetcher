'use client';

import { ActionIcon, Button, Modal, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { TablerIcon } from '@tabler/icons-react';
// import * as TablerIconsProps from '@tabler/icons-react';
import { ReactNode, useState } from 'react';

export type ManagerEntry = {
    id: string;
    name: string;
    description: string;
    href: string;
    Icon: TablerIcon;
    color?: string;
};

type ManagerCatalogProps = {
    entries: ManagerEntry[];
};

export function ManagerCatalog({ entries }: ManagerCatalogProps) {
    const [selected, setSelected] = useState<ManagerEntry | null>(null);

    return (
        <>
            <SimpleGrid
                cols={{ base: 2, sm: 3 }}
                spacing={{ base: 'lg', sm: 'xl' }}
                verticalSpacing={{ base: 'lg', sm: 'xl' }}
            >
                {entries.map((entry) => (
                    <div
                        key={entry.id}
                        style={{ display: 'flex', justifyContent: 'center' }}
                    >
                        <Tooltip
                            label={entry.name}
                            position="top"
                            withArrow
                        >
                            <ActionIcon
                                size={110}
                                radius="xl"
                                variant="light"
                                color={entry.color ?? 'gray'}
                                onClick={() => setSelected(entry)}
                                aria-label={`${entry.name} の詳細を表示`}
                                style={{ width: 110, height: 110 }}
                            >
                                <entry.Icon size={48} stroke={1.3} />
                            </ActionIcon>
                        </Tooltip>
                    </div>
                ))}
            </SimpleGrid>

            <Modal
                opened={selected !== null}
                onClose={() => setSelected(null)}
                title={selected?.name}
                centered
                radius="lg"
            >
                {selected && (
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">
                            {selected.description}
                        </Text>
                        <Button
                            component="a"
                            href={selected.href}
                            radius="lg"
                            color={selected.color ?? 'dark'}
                        >
                            {selected.name}ページへ移動
                        </Button>
                    </Stack>
                )}
            </Modal>
        </>
    );
}
