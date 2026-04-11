'use client';

import { PackageUploadModal } from '@/components/PackageUpload/Modal';
import { FileItem } from '@/components/Upload/FileItem';
import { ProgressEvent } from '@/lib/progressBus';
import { useRetryableEventSource } from '@/lib/useRetryableEventSource';
import { Accordion, Alert, Button, Checkbox, Group, PasswordInput, Radio, Space, Stack, Text, TextInput } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconCloudCog, IconCloudUpload, IconDownload, IconX } from '@tabler/icons-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';

type EnvProps = {
    RPM_UPLOAD: string;
    RPM_UPLOAD_REPOSITORY_URL: string;
    RPM_UPLOAD_USERNAME: string;
    RPM_UPLOAD_PASSWORD: string;
    RPM_UPLOAD_TOKEN: string;
    RPM_UPLOAD_METHOD: string;
    RPM_UPLOAD_IGNORE_TLS_VERIFY: string;
};

type PerFileState = { received: number; total?: number; status: string };

type FormValues = {
    files: File[];
    repositoryUrl: string;
    username: string;
    password: string;
    token: string;
    method: 'put' | 'post';
    ignoreTlsVerify: boolean;
};

const FLUSH_INTERVAL = 250;

export function UploadPane({ env }: { env: EnvProps }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [opened, { open, close }] = useDisclosure(false);

    const perFileRef = useRef<Record<number, PerFileState>>({});
    const [perFileSnap, setPerFileSnap] = useState<Record<number, PerFileState>>({});
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const stopSseRef = useRef<() => void>(() => {});
    const indexMapRef = useRef<Map<number, number>>(new Map());

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setPerFileSnap({ ...perFileRef.current });
        }, FLUSH_INTERVAL);
    }, []);

    const resetStreams = useCallback(() => {
        setJobId(null);
        perFileRef.current = {};
        setPerFileSnap({});
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
            repositoryUrl: env.RPM_UPLOAD_REPOSITORY_URL || '',
            username: env.RPM_UPLOAD_USERNAME || '',
            password: env.RPM_UPLOAD_PASSWORD || '',
            token: env.RPM_UPLOAD_TOKEN || '',
            method: env.RPM_UPLOAD_METHOD === 'post' ? 'post' : 'put',
            ignoreTlsVerify: ['1', 'true', 'yes', 'on'].includes((env.RPM_UPLOAD_IGNORE_TLS_VERIFY || '').toLowerCase()),
        },
    });

    const handleSseEvent = useCallback((data: ProgressEvent) => {
        const resolveIndex = (incomingIndex: number) => indexMapRef.current.get(incomingIndex) ?? null;
        if (data.type === 'item-start' && (data.scope === 'rpm-upload' || data.scope === 'rpm-publish')) {
            const targetIndex = resolveIndex(data.index); if (targetIndex === null) return;
            perFileRef.current = { ...perFileRef.current, [targetIndex]: { ...perFileRef.current[targetIndex], status: data.scope === 'rpm-upload' ? 'uploading' : 'publishing' } };
            scheduleFlush(); return;
        }
        if (data.type === 'item-progress' && data.scope === 'rpm-upload') {
            const targetIndex = resolveIndex(data.index); if (targetIndex === null) return;
            perFileRef.current = { ...perFileRef.current, [targetIndex]: { ...perFileRef.current[targetIndex], status: 'uploading', received: data.received, total: data.total ?? perFileRef.current[targetIndex]?.total } };
            scheduleFlush(); return;
        }
        if (data.type === 'item-done' && (data.scope === 'rpm-upload' || data.scope === 'rpm-publish')) {
            const targetIndex = resolveIndex(data.index); if (targetIndex === null) return;
            const prev = perFileRef.current[targetIndex];
            perFileRef.current = { ...perFileRef.current, [targetIndex]: { ...prev, status: data.scope === 'rpm-upload' ? 'uploaded' : 'published', received: prev?.total ?? prev?.received ?? 0 } };
            scheduleFlush(); return;
        }
        if (data.type === 'item-error' && data.scope === 'rpm-publish') {
            const targetIndex = resolveIndex(data.index); if (targetIndex === null) return;
            perFileRef.current = { ...perFileRef.current, [targetIndex]: { ...perFileRef.current[targetIndex], status: 'error' } };
            setError((cur) => cur || data.message || 'アップロードに失敗しました');
            scheduleFlush(); return;
        }
        if (data.type === 'error') {
            setLoading(false); setError(data.message || 'アップロードに失敗しました'); stopSseRef.current(); indexMapRef.current = new Map();
            return;
        }
        if (data.type === 'done') {
            setLoading(false); scheduleFlush(); stopSseRef.current(); indexMapRef.current = new Map();
        }
    }, [scheduleFlush]);

    const { start: startSse, stop: stopSse } = useRetryableEventSource({
        onMessage: (event) => {
            try { handleSseEvent(JSON.parse(event.data) as ProgressEvent); } catch {}
        },
        onError: () => undefined,
        notificationId: 'rpm-upload-sse',
        notificationLabel: 'rpmアップロード進捗',
    });

    useEffect(() => { stopSseRef.current = stopSse; }, [stopSse]);
    useEffect(() => () => stopSseRef.current(), []);

    const startUpload = useCallback(async () => {
        const current = form.getValues();
        const files = current.files || [];
        if (!files.length) { setError('アップロードするRPMファイルを選択してください'); return; }
        if (!current.repositoryUrl.trim()) { setError('レジストリURLを入力してください'); return; }

        setLoading(true);
        setError(null);
        resetStreams();

        const next: Record<number, PerFileState> = {};
        files.forEach((file, idx) => { next[idx] = { received: 0, total: file.size, status: 'waiting' }; });
        perFileRef.current = next;
        setPerFileSnap({ ...next });

        const newJobId = nanoid();
        setJobId(newJobId);
        open();

        indexMapRef.current = new Map(files.map((_, idx) => [idx, idx]));
        startSse(`/api/build/progress?jobId=${newJobId}`);

        const fd = new FormData();
        for (const file of files) fd.append('files', file, file.name);

        const params = new URLSearchParams({ jobId: newJobId, repositoryUrl: current.repositoryUrl.trim(), method: current.method });
        if (current.username.trim()) params.set('username', current.username.trim());
        if (current.password) params.set('password', current.password);
        if (current.token.trim()) params.set('token', current.token.trim());
        if (current.ignoreTlsVerify) params.set('ignoreTlsVerify', 'true');

        try {
            const res = await fetch(`/api/rpm/upload?${params.toString()}`, { method: 'POST', body: fd });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data?.error || 'upload failed');
            }
        } catch (err: any) {
            setLoading(false);
            setError(err?.message || 'アップロードに失敗しました');
            stopSseRef.current();
            indexMapRef.current = new Map();
        }
    }, [form, open, resetStreams, startSse]);

    const handleClose = useCallback(() => {
        const current = jobId;
        close();
        resetStreams();
        if (current) fetch(`/api/build/delete?jobId=${current}`, { method: 'POST' }).catch(() => undefined);
    }, [jobId, close, resetStreams]);

    return (
        <div>
            <Alert variant="light" color="yellow" title="注意" radius="lg" my="xl">アップロード先RPMリポジトリは URL/認証方式が実装により異なります。PUT/POST を切り替えて利用してください。</Alert>
            <Stack>
                <Dropzone
                    accept={['.rpm', 'application/x-rpm', 'application/x-redhat-package-manager', 'application/octet-stream']}
                    onDrop={(files) => form.setFieldValue('files', [...form.getValues().files, ...files])}
                    onReject={() => setError('rpmファイルのみアップロードできます')}
                    disabled={loading}
                >
                    <Group justify="center" gap="xl" mih={120} style={{ pointerEvents: 'none' }}>
                        <Dropzone.Accept><IconDownload size={52} color="var(--mantine-color-blue-6)" stroke={1.5} /></Dropzone.Accept>
                        <Dropzone.Reject><IconX size={52} color="var(--mantine-color-red-6)" stroke={1.5} /></Dropzone.Reject>
                        <Dropzone.Idle><IconCloudUpload size={52} color="var(--mantine-color-dimmed)" stroke={1.5} /></Dropzone.Idle>
                        <div><Text size="xl" inline>ここにファイルをドロップするかクリックして選択</Text><Text size="sm" c="dimmed" inline mt={7}>複数rpmファイルをまとめてアップロードできます</Text></div>
                    </Group>
                </Dropzone>
                <Stack gap="xs">{form.getValues().files.map((file, index) => { const total = perFileSnap[index]?.total ?? file.size; const received = perFileSnap[index]?.received ?? 0; const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0; return <FileItem key={`${file.name}-${index}`} file={file} status={perFileSnap[index]?.status ?? 'waiting'} percent={percent} onDelete={(target) => form.setFieldValue('files', form.getValues().files.filter((item) => item !== target))} loading={loading} />; })}</Stack>

                <Accordion radius="md" variant="contained"><Accordion.Item value="registry"><Accordion.Control icon={<IconCloudCog size={16} />}>アップロード設定</Accordion.Control><Accordion.Panel><Stack>
                    <TextInput label="Repository URL" placeholder="https://nexus.example.com/repository/rpm-hosted/" key={form.key('repositoryUrl')} {...form.getInputProps('repositoryUrl')} disabled={loading} />
                    <Radio.Group label="HTTP Method" key={form.key('method')} {...form.getInputProps('method')}><Group mt="xs"><Radio value="put" label="PUT" /><Radio value="post" label="POST" /></Group></Radio.Group>
                    <TextInput label="Username" key={form.key('username')} {...form.getInputProps('username')} disabled={loading} />
                    <PasswordInput label="Password" key={form.key('password')} {...form.getInputProps('password')} disabled={loading} />
                    <PasswordInput label="Bearer Token" key={form.key('token')} {...form.getInputProps('token')} disabled={loading} />
                    <Checkbox label="証明書の検証を無視する (curl --insecure)" key={form.key('ignoreTlsVerify')} {...form.getInputProps('ignoreTlsVerify', { type: 'checkbox' })} disabled={loading} />
                </Stack></Accordion.Panel></Accordion.Item></Accordion>

                <Space h="md" />
                <Button size="lg" radius="lg" onClick={startUpload} loading={loading}>Upload</Button>
                {error && <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">{error}</Alert>}
            </Stack>

            <PackageUploadModal opened={opened} onClose={handleClose} jobId={jobId} files={form.getValues().files} perFile={perFileSnap} status={loading ? 'running' : error ? 'error' : jobId ? 'done' : 'idle'} />
        </div>
    );
}
