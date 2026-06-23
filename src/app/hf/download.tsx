'use client';

import { ProgressEvent } from '@/lib/progressBus';
import { Alert, Button, Group, PasswordInput, Space, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconArrowRight, IconDownload, IconInfoCircle } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormCard } from '@/components/FormCard';
import { ProgressBanner, ProgressModal, type ProgressItem } from '@/components/ProgressModal';

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

    const totals = Object.values(fileState).reduce<{ received: number; total: number }>((acc, item) => {
        acc.received += item.received || 0;
        acc.total += item.total || 0;
        return acc;
    }, { received: 0, total: 0 });

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

    const indeterminate = status === 'starting' || status === 'running' || files.length === 0;
    const state: 'running' | 'done' | 'error' = status === 'done' ? 'done' : status === 'error' ? 'error' : 'running';
    const items: ProgressItem[] = files.map((file, index) => {
        const fs = fileState[index];
        const itemProgress = fs?.total ? Math.min(100, Math.floor(((fs.received || 0) / fs.total) * 100)) : 0;
        const st: ProgressItem['status'] = fs?.status === 'done' ? 'done' : fs?.status === 'downloading' ? 'running' : 'waiting';
        const name = file.path.split('/').pop() || file.path;
        return {
            key: `${file.path}-${index}`,
            label: name,
            status: st,
            percent: itemProgress,
            meta: st === 'done' ? '完了' : fs?.total ? `${(fs.total / 1_000_000).toFixed(1)}MB` : '待機',
        };
    });
    const doneCount = items.filter((i) => i.status === 'done').length;

    return (
        <>
            <form onSubmit={submit}>
                <FormCard
                    hint={<Text className="af-mono" fz={12} c="var(--af-dim)">必要ファイルを選択取得して tar 化します</Text>}
                    actions={<Button type="submit" loading={loading} size="md" radius="md" color="hf" rightSection={<IconArrowRight size="1.05rem" />}>取得を開始</Button>}
                >
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
                        <Alert color="npm" radius="md" title="Error">{error}</Alert>
                    )}
                    <Alert icon={<IconInfoCircle size={16} />} color="hf" variant="light" radius="md" title="Ollama 連携のヒント">
                        GGUF を含むパターンを指定してダウンロードすると、同梱の README-OLLAMA.md をそのまま手順書として使えます。
                    </Alert>
                </Stack>
                </FormCard>
            </form>

            <ProgressModal
                opened={opened}
                onClose={closeModal}
                accent="hf"
                title={state === 'done' ? '取得完了' : state === 'error' ? '取得に失敗' : '取得中'}
                subtitle={`${form.getValues().repoId} · ${files.length} files`}
                overallPercent={indeterminate ? undefined : progress}
                state={state}
                stats={[
                    { value: doneCount, unit: `/${files.length}`, label: '完了 / 全体', accent: state === 'done' },
                    { value: (totals.received / 1_000_000).toFixed(0), unit: ' MB', label: '取得サイズ' },
                    { value: files.length, label: 'ファイル' },
                ]}
                items={items}
                banner={state === 'done' ? <ProgressBanner tone="success" title={`${files.length} ファイルを取得しました`} detail={`${(totals.received / 1_000_000).toFixed(1)} MB`} /> : undefined}
                footer={state === 'done' ? (
                    <>
                        <Button variant="default" radius="md" onClick={closeModal}>閉じる</Button>
                        <Button color="success" radius="md" leftSection={<IconDownload size="1rem" />} component="a" href={jobId ? `/api/build/download?jobId=${jobId}` : '#'} target="_blank" disabled={!jobId}>tar をダウンロード</Button>
                    </>
                ) : (
                    <>
                        <Text className="af-mono" fz={12.5} c="var(--af-muted)">{indeterminate ? '解決しています…' : `${doneCount} / ${files.length}`}</Text>
                        <Button variant="default" radius="md" onClick={closeModal}>キャンセル</Button>
                    </>
                )}
            />

            <Space h="md" />
        </>
    );
}
