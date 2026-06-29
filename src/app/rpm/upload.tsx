'use client';

import { PackageUploadModal } from '@/components/PackageUpload/Modal';
import { FileItem } from '@/components/Upload/FileItem';
import { ProgressEvent } from '@/lib/progressBus';
import { useRetryableEventSource } from '@/lib/useRetryableEventSource';
import { buildAuthHeaders } from '@/lib/authHeaders';
import { Dropzone } from '@mantine/dropzone';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconCloudUpload, IconKey, IconServer, IconX } from '@tabler/icons-react';
import { CarbonCard, CarbonSection, CarbonField, CarbonPassword, CarbonSegmented, CarbonCheckbox, CarbonAuthPanel, CarbonFooter, CarbonSubmit, CarbonList, carbonClasses, carbonDropzoneClasses } from '@/components/CarbonForm';
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
        mode: 'controlled',
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
        if (current.ignoreTlsVerify) params.set('ignoreTlsVerify', 'true');

        try {
            const res = await fetch(`/api/rpm/upload?${params.toString()}`, {
                method: 'POST',
                headers: buildAuthHeaders({ username: current.username, password: current.password, token: current.token }),
                body: fd,
            });
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

    const files = form.getValues().files;
    const completed = Object.values(perFileSnap).filter((s) => s?.status === 'published' || s?.status === 'uploaded').length;

    return (
        <div>
            <CarbonCard accent="rpm">
                <CarbonAuthPanel
                    icon={IconServer}
                    title="アップロード先"
                    sub={`${form.getValues().repositoryUrl?.trim() || 'レジストリ未設定'} · ${String(form.getValues().method || 'put').toUpperCase()} · ${form.getValues().token ? 'トークン認証' : (form.getValues().username ? 'Basic 認証' : '認証なし')}`}
                    configured={Boolean(form.getValues().repositoryUrl?.trim())}
                    defaultOpen
                >
                    <CarbonField label="Repository URL" icon={IconServer} value={form.getValues().repositoryUrl} onChange={(v) => form.setFieldValue('repositoryUrl', v)} placeholder="https://nexus.example.com/repository/rpm-hosted/" disabled={loading} />
                    <CarbonSegmented
                        label="HTTP Method"
                        options={[{ value: 'put', label: 'PUT' }, { value: 'post', label: 'POST' }]}
                        value={form.getValues().method}
                        onChange={(v) => form.setFieldValue('method', v as 'put' | 'post')}
                        disabled={loading}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <CarbonField label="Username" optional small value={form.getValues().username} onChange={(v) => form.setFieldValue('username', v)} placeholder="username" disabled={loading} />
                        <CarbonPassword label="Password" optional value={form.getValues().password} onChange={(v) => form.setFieldValue('password', v)} placeholder="password" disabled={loading} />
                    </div>
                    <CarbonPassword label="Bearer Token" optional icon={IconKey} value={form.getValues().token} onChange={(v) => form.setFieldValue('token', v)} placeholder="token" disabled={loading} />
                    <CarbonCheckbox checked={form.getValues().ignoreTlsVerify} onChange={(c) => form.setFieldValue('ignoreTlsVerify', c)} label="証明書の検証を無視する (curl --insecure)" disabled={loading} />
                </CarbonAuthPanel>

                <CarbonSection>
                    <Dropzone
                        accept={['.rpm', 'application/x-rpm', 'application/x-redhat-package-manager', 'application/octet-stream']}
                        onDrop={(dropped) => form.setFieldValue('files', [...form.getValues().files, ...dropped])}
                        onReject={() => setError('rpmファイルのみアップロードできます')}
                        disabled={loading}
                        p="xl"
                        className={carbonDropzoneClasses.root}
                    >
                        <div style={{ pointerEvents: 'none', textAlign: 'center' }}>
                            <span className={carbonDropzoneClasses.icon}>
                                <Dropzone.Idle><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Idle>
                                <Dropzone.Accept><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Accept>
                                <Dropzone.Reject><IconX size={26} stroke={1.7} /></Dropzone.Reject>
                            </span>
                            <div className={carbonDropzoneClasses.title}>.rpm をドロップ</div>
                            <div className={carbonDropzoneClasses.sub}>または クリックして選択 ・ 複数可</div>
                        </div>
                    </Dropzone>

                    {files.length > 0 && (
                        <CarbonList title={`キュー · ${files.length} ファイル`} right={`${completed} / ${files.length} 完了`}>
                            {files.map((file, index) => {
                                const total = perFileSnap[index]?.total ?? file.size;
                                const received = perFileSnap[index]?.received ?? 0;
                                const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;
                                return <FileItem key={`${file.name}-${index}`} file={file} status={perFileSnap[index]?.status ?? 'waiting'} percent={percent} onDelete={(target) => form.setFieldValue('files', form.getValues().files.filter((item) => item !== target))} loading={loading} />;
                            })}
                        </CarbonList>
                    )}
                </CarbonSection>

                <CarbonFooter hint={files.length ? `${files.length} ファイルを ${String(form.getValues().method || 'put').toUpperCase()} で送信します` : '.rpm を追加してください'}>
                    <CarbonSubmit type="button" onClick={startUpload} loading={loading} icon={IconCloudUpload}>アップロード実行</CarbonSubmit>
                </CarbonFooter>
            </CarbonCard>

            {error && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <PackageUploadModal accent="rpm" opened={opened} onClose={handleClose} jobId={jobId} files={form.getValues().files} perFile={perFileSnap} status={loading ? 'running' : error ? 'error' : jobId ? 'done' : 'idle'} />
        </div>
    );
}
