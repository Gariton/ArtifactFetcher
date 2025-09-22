'use client';

import { Accordion, Alert, Button, Group, PasswordInput, Space, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { Dropzone } from '@mantine/dropzone';
import { IconCloudCog, IconCloudUpload, IconDownload, IconX } from '@tabler/icons-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressEvent } from '@/lib/progressBus';
import { FileItem } from '@/components/Upload/FileItem';
import { NpmUploadModal } from '@/components/NpmUpload/Modal';
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
    const stopSseRef = useRef<() => void>(() => {});
    const [env, setEnv] = useState({
        NPM_UPLOAD: "yes",
        NPM_UPLOAD_REGISTORY: "",
        NPM_UPLOAD_AUTH_TOKEN: "",
        NPM_UPLOAD_USERNAME: "",
        NPM_UPLOAD_PASSWORD: "",
    });

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setPerFileSnap({ ...perFileRef.current });
        }, FLUSH_INTERVAL);
    }, []);

    const resetStreams = useCallback(() => {
        setJobId(null);
        setStatus('idle');
        perFileRef.current = {};
        setPerFileSnap({});
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        stopSseRef.current();
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
        if (data.type === 'stage') {
            setStatus('running');
            if (data.stage === 'npm-publish-start') {
                open();
            }
            return;
        }
        if (data.type === 'item-start' && data.scope === 'npm-upload') {
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
                    ...perFileRef.current[data.index],
                    status: 'uploading',
                    received: perFileRef.current[data.index]?.received ?? 0,
                    total: perFileRef.current[data.index]?.total
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-progress' && data.scope === 'npm-upload') {
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
                    ...perFileRef.current[data.index],
                    status: 'uploading',
                    received: data.received,
                    total: perFileRef.current[data.index]?.total
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-done' && data.scope === 'npm-upload') {
            const prev = perFileRef.current[data.index];
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
                    ...prev,
                    status: 'uploaded',
                    received: prev?.total ?? prev?.received ?? 0,
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-start' && data.scope === 'npm-publish') {
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
                    ...perFileRef.current[data.index],
                    status: 'publishing',
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-done' && data.scope === 'npm-publish') {
            const prev = perFileRef.current[data.index];
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
                    ...prev,
                    status: 'published',
                    received: prev?.total ?? prev?.received ?? 0,
                }
            };
            scheduleFlush();
            return;
        }
        if (data.type === 'item-error' && data.scope === 'npm-publish') {
            const prev = perFileRef.current[data.index];
            perFileRef.current = {
                ...perFileRef.current,
                [data.index]: {
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

    const onSubmit = form.onSubmit(async (values) => {
        if (values.files.length === 0) {
            setError('アップロードするファイルを選択してください');
            return;
        }
        const registryUrl = values.registryUrl.trim();
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
        resetStreams();
        close();

        const newJobId = nanoid();
        setJobId(newJobId);
        setStatus('running');
        perFileRef.current = Object.fromEntries(
            values.files.map((file, idx) => [idx, { received: 0, total: file.size, status: 'waiting' } as FileProgressState])
        );
        setPerFileSnap({ ...perFileRef.current });
        startSse(`/api/build/progress?jobId=${newJobId}`);

        const fd = new FormData();
        for (const file of values.files) {
            fd.append('files', file, file.name);
        }

        const params = new URLSearchParams({
            jobId: newJobId,
            registryUrl,
        });
        const authTokenValue = form.getValues().authToken.trim();
        if (authTokenValue) params.set('authToken', authTokenValue);
        const usernameValue = form.getValues().username.trim();
        const passwordValue = form.getValues().password;
        if (usernameValue) params.set('username', usernameValue);
        if (passwordValue) params.set('password', passwordValue);

        try {
            const res = await fetch(`/api/npm/upload?${params.toString()}`, {
                method: 'POST',
                body: fd
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
        }
    });

    useEffect(() => {
        getEnvironmentVar().then(v => {
            setEnv({
                NPM_UPLOAD: v.NPM_UPLOAD,
                NPM_UPLOAD_REGISTORY: v.NPM_UPLOAD_REGISTORY,
                NPM_UPLOAD_AUTH_TOKEN: v.NPM_UPLOAD_AUTH_TOKEN,
                NPM_UPLOAD_USERNAME: v.NPM_UPLOAD_USERNAME,
                NPM_UPLOAD_PASSWORD: v.NPM_UPLOAD_PASSWORD
            });
            form.setFieldValue("registryUrl", v.NPM_UPLOAD_REGISTORY);
            form.setFieldValue("username", v.NPM_UPLOAD_USERNAME);
            form.setFieldValue("password", v.NPM_UPLOAD_PASSWORD);
        });
        return () => {
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            stopSseRef.current();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
                        onDrop={(files) => form.setFieldValue('files', files)}
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
                </Stack>
            </form>

            {error && (
                <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">
                    {error}
                </Alert>
            )}

            <NpmUploadModal
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
