'use client';

import { Accordion, Alert, Button, Group, PasswordInput, Space, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { Dropzone } from '@mantine/dropzone';
import { IconCloudCog, IconCloudUpload, IconDownload, IconRefresh, IconX } from '@tabler/icons-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressEvent } from '@/lib/progressBus';
import { FileItem } from '@/components/Upload/FileItem';
import { PackageUploadModal } from '@/components/PackageUpload/Modal';
import { getEnvironmentVar } from '@/components/actions';
import { useRetryableEventSource } from '@/lib/useRetryableEventSource';

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
        mode: 'uncontrolled',
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
                Object.entries(perFileRef.current).map(([key, value]) => [key, { ...value, status: value.status === 'published' ? 'published' : 'error' }])
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
        const authTokenValue = currentValues.authToken.trim();
        if (authTokenValue) params.set('authToken', authTokenValue);
        const usernameValue = currentValues.username.trim();
        const passwordValue = currentValues.password;
        if (usernameValue) params.set('username', usernameValue);
        if (passwordValue) params.set('password', passwordValue);

        try {
            const res = await fetch(`/api/npm/upload?${params.toString()}`, {
                method: 'POST',
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
            form.setFieldValue("username", v.NPM_UPLOAD_USERNAME);
            form.setFieldValue("password", v.NPM_UPLOAD_PASSWORD);
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

    return (
        <div>
            <Alert
                variant="light"
                color="yellow"
                title="注意"
                radius="lg"
                my="xl"
            >
                大きなファイルのアップロードには時間がかかる場合があります。ブラウザを閉じると中断されます。
            </Alert>

            <form onSubmit={onSubmit}>
                <Stack>
                    <Accordion
                        variant="separated"
                        radius="lg"
                    >
                        <Accordion.Item
                            value="upload_settings"
                            key="upload_settings"
                        >
                            <Accordion.Control
                                icon={<IconCloudCog size="1em"/>}
                            >
                                アップロード先設定
                            </Accordion.Control>
                            <Accordion.Panel>
                                <Stack>
                                    <TextInput
                                        label="レジストリURL"
                                        description="例: https://nexus.example.com/repository/npm-hosted"
                                        size="lg"
                                        radius="lg"
                                        placeholder="https://registry.example.com/npm"
                                        key={form.key('registryUrl')}
                                        {...form.getInputProps('registryUrl')}
                                        disabled={loading}
                                    />
                                    <TextInput
                                        label="Auth Token (任意)"
                                        description="トークン認証を使用する場合に入力"
                                        size="lg"
                                        radius="lg"
                                        placeholder="npm-xxxxxxxxxxxxxxxx"
                                        key={form.key('authToken')}
                                        {...form.getInputProps('authToken')}
                                        disabled={loading}
                                    />
                                    <Group grow>
                                        <TextInput
                                            label="ユーザー名 (任意、トークン未使用時)"
                                            size="lg"
                                            radius="lg"
                                            placeholder="username"
                                            key={form.key('username')}
                                            {...form.getInputProps('username')}
                                            disabled={loading}
                                        />
                                        <PasswordInput
                                            label="パスワード (任意、トークン未使用時)"
                                            size="lg"
                                            radius="lg"
                                            placeholder="password"
                                            key={form.key('password')}
                                            {...form.getInputProps('password')}
                                            disabled={loading}
                                            autoComplete="current-password"
                                        />
                                    </Group>
                                </Stack>
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>

                    <Dropzone
                        onDrop={(files: File[]) => form.setFieldValue('files', files)}
                        accept={["application/x-tar", "application/gzip", "application/x-compressed", "application/octet-stream"]}
                        radius="lg"
                        p="xl"
                        disabled={loading}
                    >
                        <div style={{ pointerEvents: 'none' }}>
                            <Group justify="center">
                                <Dropzone.Accept>
                                    <IconDownload size={50} color="blue.6" stroke={1.5} />
                                </Dropzone.Accept>
                                <Dropzone.Reject>
                                    <IconX size={50} color="red.6" stroke={1.5} />
                                </Dropzone.Reject>
                                <Dropzone.Idle>
                                    <IconCloudUpload size={50} stroke={1.5} />
                                </Dropzone.Idle>
                            </Group>
                            <Text ta="center" fw={700} fz="lg" mt="xl">
                                <Dropzone.Accept>ここにファイルをドロップ</Dropzone.Accept>
                                <Dropzone.Idle>npm バンドルをアップロード</Dropzone.Idle>
                                <Dropzone.Reject>対応していないファイルです</Dropzone.Reject>
                            </Text>
                            <Text ta="center" c="dimmed">
                                `.tar` / `.tgz` 形式のファイルを選択してください
                            </Text>
                        </div>
                    </Dropzone>

                    <Stack gap="xs">
                        <Text size="sm" fw={600}>
                            選択済みファイル ({form.getValues().files.length})
                        </Text>
                        {form.getValues().files.map((file, idx) => (
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
                                    const nextFiles = form.getValues().files.filter((f) => f !== target);
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
                    </Stack>

                    <Space h="md" />
                    <Button type="submit" size="lg" radius="lg" loading={loading}>
                        アップロード
                    </Button>
                    <Button
                        type="button"
                        size="lg"
                        radius="lg"
                        variant="light"
                        leftSection={<IconRefresh size="1.1rem" />}
                        onClick={handleRetryFailed}
                        disabled={loading || failedCount === 0}
                    >
                        失敗したパッケージを再試行
                    </Button>
                </Stack>
            </form>

            {error && (
                <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">
                    {error}
                </Alert>
            )}

            <PackageUploadModal
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
