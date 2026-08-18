'use client';

import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { Dropzone } from '@mantine/dropzone';
import { IconAlertCircle, IconCloudUpload, IconKey, IconRefresh, IconServer, IconX } from '@tabler/icons-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressEvent } from '@/lib/progressBus';
import { FileItem } from '@/components/Upload/FileItem';
import { PackageUploadModal } from '@/components/PackageUpload/Modal';
import { getEnvironmentVar } from '@/components/actions';
import { useRetryableEventSource } from '@/lib/useRetryableEventSource';
import { buildAuthHeaders } from '@/lib/authHeaders';
import { CarbonForm, CarbonSection, CarbonField, CarbonPassword, CarbonAuthPanel, CarbonFooter, CarbonSubmit, CarbonGhostButton, CarbonList, carbonClasses, carbonDropzoneClasses } from '@/components/CarbonForm';

const FLUSH_INTERVAL = 250;

type FormValues = {
    files: File[];
    registryUrl: string;
    authToken: string;
    username: string;
    password: string;
};

type FileProgressState = { received: number; total?: number; status: string };

export function UploadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [opened, { open, close }] = useDisclosure(false);

    const perFileRef = useRef<Record<number, FileProgressState>>({});
    const [perFileSnap, setPerFileSnap] = useState<Record<number, FileProgressState>>({});
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const indexMapRef = useRef<Map<number, number>>(new Map());
    const stopSseRef = useRef<() => void>(() => {});

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setPerFileSnap({ ...perFileRef.current });
        }, FLUSH_INTERVAL);
    }, []);

    const resetStreams = useCallback(({ preserveProgress = false }: { preserveProgress?: boolean } = {}) => {
        setJobId(null);
        setStatus('idle');
        if (!preserveProgress) {
            perFileRef.current = {};
            setPerFileSnap({});
        } else {
            setPerFileSnap({ ...perFileRef.current });
        }
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        stopSseRef.current();
        indexMapRef.current = new Map();
    }, []);

    const form = useForm<FormValues>({
        mode: 'controlled',
        initialValues: {
            files: [],
            registryUrl: '',
            authToken: '',
            username: '',
            password: '',
        },
        validate: {
            registryUrl: (v) => (v.trim() === '' ? 'レジストリURLを入力してください' : null),
        },
    });

    const handleSseEvent = useCallback((data: ProgressEvent) => {
        const resolveIndex = (incomingIndex: number) => {
            const mapped = indexMapRef.current.get(incomingIndex);
            return mapped ?? null;
        };

        if (data.type === 'stage') {
            setStatus('running');
            if (data.stage === 'npm-publish-start') {
                open();
            }
            return;
        }
        if (data.type === 'item-start' && data.scope === 'npm-upload') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...perFileRef.current[targetIndex],
                    status: 'uploading',
                    received: perFileRef.current[targetIndex]?.received ?? 0,
                    total: perFileRef.current[targetIndex]?.total
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-progress' && data.scope === 'npm-upload') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...perFileRef.current[targetIndex],
                    status: 'uploading',
                    received: data.received,
                    total: perFileRef.current[targetIndex]?.total
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-done' && data.scope === 'npm-upload') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            const prev = perFileRef.current[targetIndex];
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...prev,
                    status: 'uploaded',
                    received: prev?.total ?? prev?.received ?? 0,
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-start' && data.scope === 'npm-publish') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...perFileRef.current[targetIndex],
                    status: 'publishing',
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-done' && data.scope === 'npm-publish') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            const prev = perFileRef.current[targetIndex];
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...prev,
                    status: 'published',
                    received: prev?.total ?? prev?.received ?? 0,
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-skip' && data.scope === 'npm-publish') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            const prev = perFileRef.current[targetIndex];
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...prev,
                    status: 'skipped',
                    received: prev?.total ?? prev?.received ?? 0,
                },
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-error' && data.scope === 'npm-publish') {
            const targetIndex = resolveIndex(data.index);
            if (targetIndex === null) return;
            const prev = perFileRef.current[targetIndex];
            perFileRef.current = {
                ...perFileRef.current,
                [targetIndex]: {
                    ...prev,
                    status: 'error',
                    received: prev?.received ?? 0,
                    total: prev?.total,
                },
            };
            setError(data.message || 'アップロードに失敗しました');
            scheduleFlush();
            return;
        }
        if (data.type === 'error-summary') {
            const failedNames = data.failures.map((f) => f.name).join(', ');
            setError(failedNames ? `一部のパッケージでエラー: ${failedNames}` : '一部パッケージでエラーが発生しました');
            scheduleFlush();
            return;
        }
        if (data.type === 'done') {
            setStatus('done');
            setLoading(false);
            scheduleFlush();
            stopSseRef.current();
            indexMapRef.current = new Map();
            return;
        }
        if (data.type === 'error') {
            setStatus('error');
            setLoading(false);
            setError(data.message || 'アップロードに失敗しました');
            perFileRef.current = Object.fromEntries(
                Object.entries(perFileRef.current).map(([key, value]) => [key, {
                    ...value,
                    status: value.status === 'published' || value.status === 'skipped' ? value.status : 'error',
                }])
            ) as Record<number, FileProgressState>;
            scheduleFlush();
            stopSseRef.current();
            indexMapRef.current = new Map();
            return;
        }
    }, [scheduleFlush, open]);

    const handleSseMessage = useCallback((event: MessageEvent) => {
        try {
            const payload = JSON.parse(event.data) as ProgressEvent;
            handleSseEvent(payload);
        } catch (err) {
            console.error('Failed to parse SSE payload', err);
        }
    }, [handleSseEvent]);

    const { start: startSse, stop: stopSse } = useRetryableEventSource({
        onMessage: handleSseMessage,
        onOpen: () => {
            console.debug('SSE open');
        },
        onError: (event) => {
            console.error('SSE error', event);
        },
        notificationId: 'npm-upload-sse',
        notificationLabel: 'npmアップロード進捗'
    });

    useEffect(() => {
        stopSseRef.current = stopSse;
    }, [stopSse]);

    const startUpload = useCallback(async (targetIndices?: number[]) => {
        const currentValues = form.getValues();
        const allFiles = currentValues.files;
        const indices = (targetIndices ?? allFiles.map((_, idx) => idx)).filter((idx) => idx >= 0 && idx < allFiles.length && allFiles[idx]);
        const filesToUpload = indices.map((idx) => allFiles[idx]!);

        if (filesToUpload.length === 0) {
            setError('アップロードするファイルを選択してください');
            return;
        }

        const registryUrl = (currentValues.registryUrl || '').trim();
        if (!registryUrl) {
            setError('レジストリURLを入力してください');
            return;
        }
        try {
            new URL(registryUrl);
        } catch {
            setError('レジストリURLの形式が正しくありません');
            return;
        }

        setLoading(true);
        setError(null);

        const preserveProgress = Boolean(targetIndices && targetIndices.length);
        resetStreams({ preserveProgress });
        if (!preserveProgress) {
            close();
        }

        const nextPerFile: Record<number, FileProgressState> = preserveProgress ? { ...perFileRef.current } : {};
        if (preserveProgress) {
            for (const idx of indices) {
                const file = allFiles[idx];
                if (!file) continue;
                nextPerFile[idx] = { received: 0, total: file.size, status: 'waiting' };
            }
        } else {
            for (let i = 0; i < allFiles.length; i++) {
                const file = allFiles[i];
                if (!file) continue;
                nextPerFile[i] = { received: 0, total: file.size, status: 'waiting' };
            }
        }
        perFileRef.current = nextPerFile;
        setPerFileSnap({ ...perFileRef.current });

        const newJobId = nanoid();
        setJobId(newJobId);
        setStatus('running');

        indexMapRef.current = new Map(indices.map((originalIndex, order) => [order, originalIndex]));
        startSse(`/api/build/progress?jobId=${newJobId}`);

        const fd = new FormData();
        for (const file of filesToUpload) {
            fd.append('files', file, file.name);
        }

        const params = new URLSearchParams({
            jobId: newJobId,
            registryUrl,
        });

        try {
            const res = await fetch(`/api/npm/upload?${params.toString()}`, {
                method: 'POST',
                headers: buildAuthHeaders({
                    username: currentValues.username,
                    password: currentValues.password,
                    token: currentValues.authToken,
                }),
                body: fd,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'アップロードの開始に失敗しました');
            }
        } catch (e: any) {
            setLoading(false);
            setStatus('error');
            setError(e?.message || 'アップロードに失敗しました');
            stopSse();
            indexMapRef.current = new Map();
        }
    }, [close, form, resetStreams, startSse, stopSse]);

    const onSubmit = form.onSubmit(() => {
        void startUpload();
    });

    const handleRetryFailed = useCallback(() => {
        if (loading) return;
        const failedIndices = Object.entries(perFileRef.current)
            .filter(([, value]) => value?.status === 'error')
            .map(([key]) => Number(key));
        if (failedIndices.length === 0) return;
        void startUpload(failedIndices);
    }, [loading, startUpload]);

    useEffect(() => {
        getEnvironmentVar().then(v => {
            form.setFieldValue("registryUrl", v.NPM_UPLOAD_REGISTRY);
        });
        return () => {
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            stopSseRef.current();
            indexMapRef.current = new Map();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const failedCount = Object.values(perFileSnap).filter((state) => state?.status === 'error').length;

    const files = form.getValues().files;
    const completed = Object.values(perFileSnap).filter((s) => ['published', 'uploaded', 'skipped'].includes(s?.status)).length;

    return (
        <div>
            <CarbonForm accent="npm" onSubmit={onSubmit}>
                <CarbonAuthPanel
                    icon={IconServer}
                    title="アップロード先"
                    sub={`${form.getValues().registryUrl?.trim() || 'レジストリ未設定'} · ${form.getValues().authToken ? 'トークン認証' : (form.getValues().username ? 'Basic 認証' : '認証なし')}`}
                    configured={Boolean(form.getValues().registryUrl?.trim())}
                    defaultOpen
                >
                    <CarbonField
                        label="レジストリ URL"
                        icon={IconServer}
                        value={form.getValues().registryUrl}
                        onChange={(v) => form.setFieldValue('registryUrl', v)}
                        placeholder="https://nexus.example.com/repository/npm-hosted"
                        disabled={loading}
                    />
                    <CarbonPassword
                        label="Auth Token"
                        optional
                        icon={IconKey}
                        value={form.getValues().authToken}
                        onChange={(v) => form.setFieldValue('authToken', v)}
                        placeholder="npm-xxxxxxxxxxxxxxxx"
                        disabled={loading}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <CarbonField label="ユーザー名" optional small value={form.getValues().username} onChange={(v) => form.setFieldValue('username', v)} placeholder="username" disabled={loading} />
                        <CarbonPassword label="パスワード" optional value={form.getValues().password} onChange={(v) => form.setFieldValue('password', v)} placeholder="password" disabled={loading} />
                    </div>
                </CarbonAuthPanel>

                <CarbonSection>
                    <Dropzone
                        onDrop={(dropped: File[]) => form.setFieldValue('files', dropped)}
                        accept={["application/x-tar", "application/gzip", "application/x-compressed", "application/octet-stream"]}
                        p="xl"
                        disabled={loading}
                        className={carbonDropzoneClasses.root}
                    >
                        <div style={{ pointerEvents: 'none', textAlign: 'center' }}>
                            <span className={carbonDropzoneClasses.icon}>
                                <Dropzone.Idle><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Idle>
                                <Dropzone.Accept><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Accept>
                                <Dropzone.Reject><IconX size={26} stroke={1.7} /></Dropzone.Reject>
                            </span>
                            <div className={carbonDropzoneClasses.title}>
                                <Dropzone.Idle>ここに .tar / .tgz をドロップ</Dropzone.Idle>
                                <Dropzone.Accept>ここにドロップ</Dropzone.Accept>
                                <Dropzone.Reject>対応していないファイルです</Dropzone.Reject>
                            </div>
                            <div className={carbonDropzoneClasses.sub}>または クリックして選択 ・ 複数可</div>
                        </div>
                    </Dropzone>

                    {files.length > 0 && (
                        <CarbonList title={`キュー · ${files.length} ファイル`} right={`${completed} / ${files.length} 完了`}>
                            {files.map((file, idx) => (
                                <FileItem
                                    key={`${file.name}-${idx}`}
                                    file={file}
                                    status={perFileSnap[idx]?.status ?? 'waiting'}
                                    percent={(() => {
                                        const info = perFileSnap[idx];
                                        const total = info?.total ?? file.size;
                                        const received = info?.received ?? 0;
                                        return total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
                                    })()}
                                    onDelete={(target) => {
                                        if (loading) return;
                                        const nextFiles = files.filter((f) => f !== target);
                                        form.setFieldValue('files', nextFiles);
                                        perFileRef.current = Object.fromEntries(
                                            nextFiles.map((f, index) => [index, { received: 0, total: f.size, status: 'waiting' }])
                                        );
                                        setPerFileSnap({ ...perFileRef.current });
                                    }}
                                    loading={loading}
                                    disabled={loading}
                                />
                            ))}
                        </CarbonList>
                    )}
                </CarbonSection>

                <CarbonFooter hint={files.length ? `${files.length} ファイルを publish します` : 'tar / tgz を追加してください'}>
                    {failedCount > 0 && !loading && (
                        <CarbonGhostButton onClick={handleRetryFailed}>
                            <IconRefresh size={15} /> 失敗を再試行
                        </CarbonGhostButton>
                    )}
                    <CarbonSubmit loading={loading} icon={IconCloudUpload}>アップロード実行</CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            {error && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <PackageUploadModal
                accent="npm"
                opened={opened}
                onClose={() => {
                    close();
                    if (status !== 'running') {
                        resetStreams();
                    }
                }}
                files={form.getValues().files}
                perFile={perFileSnap}
                status={status}
                jobId={jobId}
            />
        </div>
    );
}
