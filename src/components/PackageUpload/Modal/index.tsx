'use client';

import { Badge, Button, Group, Loader, Modal, ModalProps, Progress, ScrollArea, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconHourglassLow, IconStackFront } from '@tabler/icons-react';

type FileProgress = {
    received: number;
    total?: number;
    status: string;
};

type Props = {
    files: File[];
    perFile: Record<number, FileProgress>;
    status: 'idle' | 'running' | 'done' | 'error';
    jobId: string | null;
} & ModalProps;

function statusBadge(status: Props['status']) {
    switch (status) {
        case 'done':
            return (
                <Badge color="green" leftSection={<IconCircleCheck size="1em" />} radius="sm">
                    done
                </Badge>
            );
        case 'error':
            return (
                <Badge color="red" radius="sm">
                    error
                </Badge>
            );
        case 'running':
            return (
                <Badge color="gray" leftSection={<Loader size="1em" color="white" />} radius="sm">
                    running
                </Badge>
            );
        default:
            return (
                <Badge color="gray" radius="sm" leftSection={<IconHourglassLow size="1em" />}>
                    idle
                </Badge>
            );
    }
}

export function PackageUploadModal({ files, perFile, status, jobId, onClose, ...props }: Props) {
    return (
        <Modal
            {...props}
            centered
            radius="lg"
            size="lg"
            transitionProps={{ transition: 'pop' }}
            onClose={onClose}
            withCloseButton={false}
        >
            <Stack gap="md">
                <Group justify="space-between">
                    <Group gap="xs">
                        <IconStackFront />
                        <Text fw="bold" size="lg">
                            アップロード進捗
                        </Text>
                    </Group>
                    {statusBadge(status)}
                </Group>
                {jobId && (
                    <Text size="xs" c="dimmed">
                        jobId: {jobId}
                    </Text>
                )}
                <ScrollArea
                    h={550}
                >
                    <Stack gap="sm">
                        {files.length === 0 ? (
                            <Text c="dimmed" size="sm">
                                ファイルが選択されていません。
                            </Text>
                        ) : (
                            files.map((file, idx) => {
                                const info = perFile[idx];
                                const total = info?.total ?? file.size;
                                const received = info?.received ?? 0;
                                const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
                                const statusLabel = (() => {
                                    switch (info?.status) {
                                        case 'uploading':
                                            return 'uploading';
                                        case 'uploaded':
                                            return 'uploaded';
                                        case 'publishing':
                                            return 'publishing';
                                        case 'published':
                                            return 'published';
                                        case 'waiting':
                                            return 'waiting';
                                        default:
                                            return info?.status ?? 'waiting';
                                    }
                                })();
                                const badgeColor = (() => {
                                    switch (statusLabel) {
                                        case 'publishing':
                                        case 'uploading':
                                            return 'blue';
                                        case 'published':
                                            return 'green';
                                        case 'uploaded':
                                            return 'teal';
                                        case 'error':
                                            return 'red';
                                        case 'waiting':
                                            return 'gray';
                                        default:
                                            return 'gray';
                                    }
                                })();
                                return (
                                    <Stack key={`${file.name}-${idx}`} gap={4}>
                                        <Group justify="space-between">
                                            <Text size="sm" fw={500} lineClamp={1}>
                                                {file.name}
                                            </Text>
                                            <Badge radius="sm" color={badgeColor}>
                                                {statusLabel}
                                            </Badge>
                                        </Group>
                                        <Progress value={percent} size="lg" radius="xl" />
                                        <Text size="xs" c="dimmed">
                                            {(received / 1_000_000).toFixed(2)}MB / {(total / 1_000_000).toFixed(2)}MB
                                        </Text>
                                    </Stack>
                                );
                            })
                        )}
                    </Stack>
                </ScrollArea>

                <Button onClick={onClose} variant="outline" radius="lg">
                    閉じる
                </Button>
            </Stack>
        </Modal>
    );
}
