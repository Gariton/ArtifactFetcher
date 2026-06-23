'use client';

import { ProgressEvent } from '@/lib/progressBus';
import { Button, Space, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconBrain, IconDownload, IconInfoCircle, IconKey } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressBanner, ProgressModal, type ProgressItem } from '@/components/ProgressModal';
import { CarbonForm, CarbonSection, CarbonField, CarbonTextarea, CarbonPassword, CarbonAuthPanel, CarbonFooter, CarbonSubmit, CarbonGhostButton } from '@/components/CarbonForm';

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
        mode: 'controlled',
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

    const v = form.getValues();
    return (
        <>
            <CarbonForm accent="hf" onSubmit={submit}>
                <CarbonAuthPanel
                    icon={IconKey}
                    title="認証設定"
                    sub={`Hugging Face Token · ${v.token ? '設定済' : 'gated model のみ必要'}`}
                    configured={Boolean(v.token)}
                    defaultOpen={false}
                >
                    <CarbonPassword
                        label="Hugging Face Token"
                        optional
                        icon={IconKey}
                        value={v.token}
                        onChange={(val) => form.setFieldValue('token', val)}
                        placeholder="hf_xxx"
                        disabled={loading}
                    />
                </CarbonAuthPanel>

                <CarbonSection label="取得対象">
                    <CarbonField
                        label="Model Repo ID"
                        required
                        accent
                        icon={IconBrain}
                        value={v.repoId}
                        onChange={(val) => form.setFieldValue('repoId', val)}
                        placeholder="Qwen/Qwen2.5-0.5B-Instruct-GGUF"
                        disabled={loading}
                        error={form.errors.repoId as string | undefined}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <CarbonField label="Revision" small value={v.revision} onChange={(val) => form.setFieldValue('revision', val)} placeholder="main" disabled={loading} />
                        <CarbonField label="Bundle name" optional small value={v.bundleName} onChange={(val) => form.setFieldValue('bundleName', val)} placeholder="qwen2.5-local" disabled={loading} />
                    </div>
                    <CarbonTextarea label="Include patterns" small value={v.includePatterns} onChange={(val) => form.setFieldValue('includePatterns', val)} rows={4} disabled={loading} desc="1行1パターン" />
                    <CarbonTextarea label="Exclude patterns" small value={v.excludePatterns} onChange={(val) => form.setFieldValue('excludePatterns', val)} rows={2} disabled={loading} desc="1行1パターン" />
                    {error && (
                        <Text c="var(--af-error)" fz={12}>{error}</Text>
                    )}
                </CarbonSection>

                <CarbonFooter hint="必要ファイルを選択取得して tar 化します">
                    {jobId && <CarbonGhostButton onClick={open}>進捗を表示</CarbonGhostButton>}
                    <CarbonSubmit loading={loading}>取得を開始</CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            <Text fz={12} c="var(--af-dim)" mt="sm" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <IconInfoCircle size={14} /> GGUF を含むパターンを指定すると、同梱の README-OLLAMA.md をそのまま手順書として使えます。
            </Text>

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
