'use client';

import { ProgressEvent } from '@/lib/progressBus';
import { Alert, Badge, Button, Card, Group, Loader, Modal, PasswordInput, Progress, ScrollArea, Space, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleCheck, IconDownload, IconInfoCircle } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Status = 'idle' | 'starting' | 'running' | 'done' | 'error';

type HfFileItem = {
    path: string;
    size?: number;
};

type FileState = {
    received: number;
    total?: number;
    status: 'waiting' | 'downloading' | 'done';
};

type FormValues = {
    repoId: string;
    revision: string;
    bundleName: string;
    includePatterns: string;
    excludePatterns: string;
    token: string;
};

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [jobId, setJobId] = useState<string | null>(null);
    const [files, setFiles] = useState<HfFileItem[]>([]);
    const [fileState, setFileState] = useState<Record<number, FileState>>({});
    const [opened, { open, close }] = useDisclosure(false);
    const esRef = useRef<EventSource | null>(null);

    const form = useForm<FormValues>({
        initialValues: {
            repoId: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
            revision: 'main',
            bundleName: '',
            includePatterns: '*.gguf\n*.json\ntokenizer*\n*.model',
            excludePatterns: '*.safetensors',
            token: '',
        },
        validate: {
            repoId: (value) => (value.trim() ? null : 'repoId は必須です'),
        },
    });

    const totals = useMemo(() => {
        return Object.values(fileState).reduce((acc, item) => {
            acc.received += item.received || 0;
            acc.total += item.total || 0;
            return acc;
        }, { received: 0, total: 0 });
    }, [fileState]);

    const progress = totals.total > 0 ? Math.min(100, Math.floor((totals.received / totals.total) * 100)) : 0;

    const reset = useCallback(() => {
        setStatus('idle');
        setJobId(null);
        setFiles([]);
        setFileState({});
        esRef.current?.close();
        esRef.current = null;
    }, []);

    const cleanupAndDelete = useCallback((targetJobId: string | null) => {
        if (!targetJobId) return;
        (async () => {
            try {
                await fetch(`/api/build/delete?jobId=${targetJobId}`, { method: 'POST' });
            } catch {}
        })();
    }, []);

    useEffect(() => {
        return () => {
            esRef.current?.close();
        };
    }, []);

    const handleProgress = useCallback((event: ProgressEvent) => {
        if (event.type === 'stage') {
            if (event.stage === 'queued') setStatus('starting');
            else if (event.stage.startsWith('hf') || event.stage === 'uploading-s3') setStatus('running');
            return;
        }

        if (event.type === 'manifest-resolved') {
            const items = (event.items as HfFileItem[]).map((item) => ({ path: item.path, size: item.size }));
            setFiles(items);
            setFileState((prev) => {
                const next: Record<number, FileState> = { ...prev };
                items.forEach((item, index) => {
                    if (!next[index]) {
                        next[index] = { received: 0, total: item.size, status: 'waiting' };
                    }
                });
                return next;
            });
            return;
        }

        if (event.type === 'item-start' && event.scope === 'hf-download') {
            setFileState((prev) => ({
                ...prev,
                [event.index]: {
                    received: prev[event.index]?.received ?? 0,
                    total: event.total ?? prev[event.index]?.total,
                    status: 'downloading',
                },
            }));
            return;
        }

        if (event.type === 'item-progress' && event.scope === 'hf-download') {
            setFileState((prev) => ({
                ...prev,
                [event.index]: {
                    received: event.received,
                    total: event.total ?? prev[event.index]?.total,
                    status: 'downloading',
                },
            }));
            return;
        }

        if (event.type === 'item-done' && event.scope === 'hf-download') {
            setFileState((prev) => ({
                ...prev,
                [event.index]: {
                    received: prev[event.index]?.total ?? prev[event.index]?.received ?? 0,
                    total: prev[event.index]?.total,
                    status: 'done',
                },
            }));
            return;
        }

        if (event.type === 'done') {
            setStatus('done');
            return;
        }

        if (event.type === 'error') {
            setStatus('error');
            setError(event.message);
        }
    }, []);

    const submit = form.onSubmit(async (values) => {
        setError(null);
        setLoading(true);
        setStatus('starting');
        setFiles([]);
        setFileState({});
        open();

        try {
            const includePatterns = values.includePatterns
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const excludePatterns = values.excludePatterns
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);

            const res = await fetch('/api/hf/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repoId: values.repoId.trim(),
                    revision: values.revision.trim() || 'main',
                    bundleName: values.bundleName.trim() || undefined,
                    includePatterns,
                    excludePatterns,
                    token: values.token.trim() || undefined,
                }),
            });

            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'start failed');
            }

            const nextJobId = payload.jobId as string;
            setJobId(nextJobId);

            esRef.current?.close();
            const es = new EventSource(`/api/build/progress?jobId=${nextJobId}`);
            esRef.current = es;
            es.onmessage = (msg) => {
                try {
                    const data = JSON.parse(msg.data) as ProgressEvent;
                    handleProgress(data);
                } catch (err) {
                    console.error(err);
                }
            };
            es.onerror = () => {
                es.close();
            };
        } catch (err: any) {
            setStatus('error');
            setError(err?.message || '開始に失敗しました');
        } finally {
            setLoading(false);
        }
    });

    const closeModal = () => {
        const current = jobId;
        close();
        reset();
        cleanupAndDelete(current);
    };

    return (
        <>
            <form onSubmit={submit}>
                <Stack>
                    <TextInput label="Model Repo ID" placeholder="Qwen/Qwen2.5-0.5B-Instruct-GGUF" required {...form.getInputProps('repoId')} />
                    <Group grow>
                        <TextInput label="Revision" placeholder="main" {...form.getInputProps('revision')} />
                        <TextInput label="Bundle name (optional)" placeholder="qwen2.5-local" {...form.getInputProps('bundleName')} />
                    </Group>
                    <Textarea label="Include patterns (1行1パターン)" minRows={4} autosize {...form.getInputProps('includePatterns')} />
                    <Textarea label="Exclude patterns (1行1パターン)" minRows={2} autosize {...form.getInputProps('excludePatterns')} />
                    <PasswordInput label="Hugging Face Token (gated modelのみ必要)" placeholder="hf_xxx" {...form.getInputProps('token')} />
                    {error && (
                        <Alert color="red" title="Error">{error}</Alert>
                    )}
                    <Alert icon={<IconInfoCircle size={16} />} color="teal" variant="light" title="Ollama 連携のヒント">
                        GGUF を含むパターンを指定してダウンロードすると、同梱の README-OLLAMA.md をそのまま手順書として使えます。
                    </Alert>
                    <Button type="submit" loading={loading} radius="lg" color="teal" leftSection={<IconDownload size="1em" />}>
                        Hugging Face から取得開始
                    </Button>
                </Stack>
            </form>

            <Modal opened={opened} onClose={closeModal} size="lg" centered title="ダウンロード進捗" radius="lg">
                <Stack>
                    <Group justify="space-between">
                        <Badge color={status === 'done' ? 'green' : status === 'error' ? 'red' : 'gray'} leftSection={status === 'done' ? <IconCircleCheck size="1em" /> : status === 'running' || status === 'starting' ? <Loader size="xs" color="white" /> : undefined}>
                            {status}
                        </Badge>
                        {jobId && <Text size="xs" c="dimmed">jobId: {jobId}</Text>}
                    </Group>
                    <Progress value={progress} radius="xl" size="lg" />
                    <Text size="xs" c="dimmed">{(totals.received / 1_000_000).toFixed(2)}MB / {(totals.total / 1_000_000).toFixed(2)}MB</Text>
                    <ScrollArea h={320}>
                        <Stack gap="xs">
                            {files.map((file, index) => {
                                const state = fileState[index];
                                const itemProgress = state?.total ? Math.min(100, Math.floor(((state.received || 0) / state.total) * 100)) : 0;
                                return (
                                    <Card withBorder key={`${file.path}-${index}`}>
                                        <Stack gap={4}>
                                            <Group justify="space-between">
                                                <Text size="sm" lineClamp={1}>{file.path}</Text>
                                                <Badge size="xs" color={state?.status === 'done' ? 'green' : state?.status === 'downloading' ? 'blue' : 'gray'}>{state?.status ?? 'waiting'}</Badge>
                                            </Group>
                                            <Progress value={itemProgress} size="sm" radius="xl" />
                                        </Stack>
                                    </Card>
                                );
                            })}
                        </Stack>
                    </ScrollArea>

                    <Button
                        component="a"
                        href={jobId ? `/api/build/download?jobId=${jobId}` : '#'}
                        target="_blank"
                        disabled={!jobId || status !== 'done'}
                        leftSection={<IconDownload size="1em" />}
                        radius="lg"
                        color="dark"
                        fullWidth
                    >
                        tar をダウンロード
                    </Button>
                </Stack>
            </Modal>

            <Space h="md" />
        </>
    );
}
