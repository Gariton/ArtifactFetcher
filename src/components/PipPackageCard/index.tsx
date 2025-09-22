import { Badge, Card, Group, Loader, Progress, Stack, Text } from '@mantine/core';
import { IconCircleCheck } from '@tabler/icons-react';
import { memo } from 'react';

type Status = 'waiting' | 'downloading' | 'done';

type PipPackageCardProps = {
    index: number;
    name: string;
    version: string;
    filename?: string;
    received: number;
    total?: number;
    status: Status;
};

function statusBadge(status: Status) {
    switch (status) {
        case 'done':
            return (
                <Badge color="green" leftSection={<IconCircleCheck size="1em" />} radius="sm">
                    done
                </Badge>
            );
        case 'downloading':
            return (
                <Badge color="blue" leftSection={<Loader size="xs" color="white" />} radius="sm">
                    downloading
                </Badge>
            );
        default:
            return (
                <Badge color="gray" radius="sm">
                    waiting
                </Badge>
            );
    }
}

export const PipPackageCard = memo(function PipPackageCardMemo({ index, name, version, filename, received, total, status }: PipPackageCardProps) {
    const percent = total && total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : status === 'done' ? 100 : 0;
    return (
        <Card withBorder radius="md" padding="md">
            <Stack gap={6}>
                <Group justify="space-between">
                    <Text size="sm" fw={600}>
                        Package {index + 1}
                    </Text>
                    {statusBadge(status)}
                </Group>
                <Stack gap={2}>
                    <Text size="sm" fw={500}>
                        {name}
                    </Text>
                    <Text size="xs" c="dimmed">
                        version: {version}{filename ? ` • ${filename}` : ''}
                    </Text>
                </Stack>
                <Progress value={percent} radius="md" size="lg" />
                <Text size="xs" c="dimmed">
                    {(received / 1_000_000).toFixed(2)}MB{total ? ` / ${(total / 1_000_000).toFixed(2)}MB` : ''}
                </Text>
            </Stack>
        </Card>
    );
});
